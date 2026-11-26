import { Hono } from 'hono';
import { and, asc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { getDb } from '../db/client';
import { attendanceLogs, departments, employees, leaveRequests } from '../db/schema';
import { type AppEnv, requireAuth, requireRole } from '../lib/session';

type DB = ReturnType<typeof getDb>;
const MNL = 8 * 3_600_000; // Manila is UTC+8
const DAY = 86_400_000;
const SHIFT_START = 8 * 60; // 8:00 AM, in minutes
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const manilaDate = (ms = Date.now()) => new Date(ms + MNL).toISOString().slice(0, 10);
const manilaMinutes = (ms = Date.now()) => {
  const d = new Date(ms + MNL);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

async function onApprovedLeave(db: DB, employeeId: string, date: string) {
  return !!(await db.select({ id: leaveRequests.id }).from(leaveRequests).where(and(
    eq(leaveRequests.employeeId, employeeId), eq(leaveRequests.status, 'approved'),
    lte(leaveRequests.startDate, date), gte(leaveRequests.endDate, date),
  )).get());
}

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

// My day: today's record, this week, and this month's summary
app.get('/me', async (c) => {
  const { employeeId } = c.get('user');
  if (!employeeId) return c.json({ error: 'Your account is not linked to an employee.' }, 400);
  const db = getDb(c.env);
  const today = manilaDate();
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = addDays(today, -((dow + 6) % 7));
  const monthStart = `${today.slice(0, 8)}01`;
  const from = monday < monthStart ? monday : monthStart;

  const [emp, logs, leaveToday] = await Promise.all([
    db.select({ firstName: employees.firstName }).from(employees).where(eq(employees.id, employeeId)).get(),
    db.select({
      workDate: attendanceLogs.workDate, timeIn: attendanceLogs.timeIn,
      timeOut: attendanceLogs.timeOut, status: attendanceLogs.status,
    }).from(attendanceLogs).where(and(
      eq(attendanceLogs.employeeId, employeeId),
      gte(attendanceLogs.workDate, from), lte(attendanceLogs.workDate, today),
    )).orderBy(asc(attendanceLogs.workDate)),
    onApprovedLeave(db, employeeId, today),
  ]);

  const summary: Record<string, number> = { present: 0, late: 0, absent: 0, on_leave: 0 };
  for (const l of logs) if (l.workDate >= monthStart) summary[l.status]++;
  const todayLog = logs.find((l) => l.workDate === today) ?? null;

  return c.json({
    firstName: emp?.firstName ?? '',
    today,
    onLeave: leaveToday || todayLog?.status === 'on_leave',
    todayLog,
    week: logs.filter((l) => l.workDate >= monday),
    summary,
  });
});

app.post('/clock-in', async (c) => {
  const { employeeId, companyId } = c.get('user');
  if (!employeeId) return c.json({ error: 'Your account is not linked to an employee.' }, 400);
  const db = getDb(c.env);
  const today = manilaDate();
  if (await onApprovedLeave(db, employeeId, today)) {
    return c.json({ error: "You're on approved leave today." }, 409);
  }
  const existing = await db.select().from(attendanceLogs)
    .where(and(eq(attendanceLogs.employeeId, employeeId), eq(attendanceLogs.workDate, today))).get();
  if (existing) {
    return c.json({ error: existing.status === 'on_leave' ? "You're on leave today." : "You've already clocked in today." }, 409);
  }
  const now = new Date();
  const status = manilaMinutes(now.getTime()) > SHIFT_START ? 'late' : 'present';
  await db.insert(attendanceLogs).values({ companyId, employeeId, workDate: today, timeIn: now, status });
  return c.json({ ok: true, status });
});

app.post('/clock-out', async (c) => {
  const { employeeId } = c.get('user');
  if (!employeeId) return c.json({ error: 'Your account is not linked to an employee.' }, 400);
  const db = getDb(c.env);
  const log = await db.select().from(attendanceLogs)
    .where(and(eq(attendanceLogs.employeeId, employeeId), eq(attendanceLogs.workDate, manilaDate()))).get();
  if (!log?.timeIn) return c.json({ error: "You haven't clocked in today." }, 409);
  if (log.timeOut) return c.json({ error: "You've already clocked out today." }, 409);
  await db.update(attendanceLogs).set({ timeOut: new Date() }).where(eq(attendanceLogs.id, log.id));
  return c.json({ ok: true });
});

// Undo an accidental clock-out (only within 5 minutes)
const UNDO_WINDOW = 5 * 60_000;
app.post('/undo-clock-out', async (c) => {
  const { employeeId } = c.get('user');
  if (!employeeId) return c.json({ error: 'Your account is not linked to an employee.' }, 400);
  const db = getDb(c.env);
  const log = await db.select().from(attendanceLogs)
    .where(and(eq(attendanceLogs.employeeId, employeeId), eq(attendanceLogs.workDate, manilaDate()))).get();
  if (!log?.timeOut) return c.json({ error: "You haven't clocked out today." }, 409);
  if (Date.now() - log.timeOut.getTime() > UNDO_WINDOW) {
    return c.json({ error: 'Undo is only available for 5 minutes. Ask HR to correct your time.' }, 409);
  }
  await db.update(attendanceLogs).set({ timeOut: null }).where(eq(attendanceLogs.id, log.id));
  return c.json({ ok: true });
});

// Team view for one date: HR/Finance see everyone, managers see their team
app.get('/team', requireRole('admin', 'finance', 'manager'), async (c) => {
  const user = c.get('user');
  const q = c.req.query('date');
  const today = manilaDate();
  const date = q && DATE_RE.test(q) ? q : today;
  const db = getDb(c.env);

  const conds = [
    eq(employees.companyId, user.companyId),
    ne(employees.status, 'resigned'),
    lte(employees.hireDate, date),
  ];
  if (user.role === 'manager') conds.push(eq(employees.managerId, user.employeeId ?? ''));

  const rows = await db.select({
    id: employees.id, firstName: employees.firstName, lastName: employees.lastName,
    department: departments.name,
    timeIn: attendanceLogs.timeIn, timeOut: attendanceLogs.timeOut, status: attendanceLogs.status,
  }).from(employees)
    .leftJoin(departments, eq(employees.departmentId, departments.id))
    .leftJoin(attendanceLogs, and(eq(attendanceLogs.employeeId, employees.id), eq(attendanceLogs.workDate, date)))
    .where(and(...conds))
    .orderBy(asc(employees.firstName), asc(employees.lastName));

  // People with no record but approved leave count as "on leave"
  const noRecord = rows.filter((r) => !r.status).map((r) => r.id);
  const leaveIds = new Set(noRecord.length
    ? (await db.select({ employeeId: leaveRequests.employeeId }).from(leaveRequests).where(and(
      inArray(leaveRequests.employeeId, noRecord), eq(leaveRequests.status, 'approved'),
      lte(leaveRequests.startDate, date), gte(leaveRequests.endDate, date),
    ))).map((r) => r.employeeId)
    : []);

  const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
  const list = rows.map((r) => ({
    ...r,
    status: r.status ?? (
      leaveIds.has(r.id) ? 'on_leave'
        : date === today ? 'not_in'
          : date > today || weekend ? 'no_record'
            : 'absent'
    ),
  }));
  const counts: Record<string, number> = {};
  for (const r of list) counts[r.status] = (counts[r.status] ?? 0) + 1;

  return c.json({ date, today, employees: list, counts });
});

export default app;