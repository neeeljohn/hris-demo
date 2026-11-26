import { Hono } from 'hono';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne } from 'drizzle-orm';
import { getDb } from '../db/client';
import { attendanceLogs, departments, employees, leaveRequests, shifts } from '../db/schema';
import { type AppEnv, requireAuth, requireRole } from '../lib/session';
import {
  DEFAULT_SHIFT, type Shift, addDays, isLate, isWeekend, manilaDate,
  shiftEndMs, shiftLabel, shiftStartMs, workDateFor,
} from '../lib/shifts';

type DB = ReturnType<typeof getDb>;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNDO_WINDOW = 5 * 60_000;

type ShiftCols = {
  shiftId: string | null; shiftName: string | null; startMinute: number | null;
  endMinute: number | null; graceMinutes: number | null;
};
const shiftCols = {
  shiftId: shifts.id, shiftName: shifts.name, startMinute: shifts.startMinute,
  endMinute: shifts.endMinute, graceMinutes: shifts.graceMinutes,
};
const toShift = (r: ShiftCols): Shift => (r.shiftId
  ? { id: r.shiftId, name: r.shiftName!, startMinute: r.startMinute!, endMinute: r.endMinute!, graceMinutes: r.graceMinutes! }
  : DEFAULT_SHIFT);

async function getEmployee(db: DB, employeeId: string) {
  const row = await db.select({ firstName: employees.firstName, ...shiftCols })
    .from(employees).leftJoin(shifts, eq(employees.shiftId, shifts.id))
    .where(eq(employees.id, employeeId)).get();
  return row ? { firstName: row.firstName, shift: toShift(row) } : null;
}

// Weekdays covered by approved leave between two dates
async function leaveDays(db: DB, employeeId: string, from: string, to: string) {
  const reqs = await db.select({ startDate: leaveRequests.startDate, endDate: leaveRequests.endDate })
    .from(leaveRequests).where(and(
      eq(leaveRequests.employeeId, employeeId), eq(leaveRequests.status, 'approved'),
      lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from),
    ));
  const days = new Set<string>();
  for (const r of reqs) {
    const end = r.endDate < to ? r.endDate : to;
    for (let d = r.startDate > from ? r.startDate : from; d <= end; d = addDays(d, 1)) {
      if (!isWeekend(d)) days.add(d);
    }
  }
  return days;
}

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

// My day
app.get('/me', async (c) => {
  const { employeeId } = c.get('user');
  if (!employeeId) return c.json({ error: 'Your account is not linked to an employee.' }, 400);
  const db = getDb(c.env);
  const emp = await getEmployee(db, employeeId);
  if (!emp) return c.json({ error: 'Employee not found.' }, 404);

  const now = Date.now();
  const today = manilaDate(now);
  const workDate = workDateFor(emp.shift, now);
  const to = workDate > today ? workDate : today;
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = addDays(today, -((dow + 6) % 7));
  const monthStart = `${today.slice(0, 8)}01`;
  const from = monday < monthStart ? monday : monthStart;

  const [logs, leave] = await Promise.all([
    db.select({
      workDate: attendanceLogs.workDate, timeIn: attendanceLogs.timeIn,
      timeOut: attendanceLogs.timeOut, status: attendanceLogs.status,
    }).from(attendanceLogs).where(and(
      eq(attendanceLogs.employeeId, employeeId),
      gte(attendanceLogs.workDate, from), lte(attendanceLogs.workDate, to),
    )).orderBy(asc(attendanceLogs.workDate)),
    leaveDays(db, employeeId, from, to),
  ]);

  const summary: Record<string, number> = { present: 0, late: 0, absent: 0, on_leave: 0 };
  for (const l of logs) if (l.workDate >= monthStart && l.status !== 'on_leave') summary[l.status]++;
  summary.on_leave = [...leave].filter((d) => d >= monthStart && d <= today).length;
  const todayLog = logs.find((l) => l.workDate === workDate) ?? null;

  return c.json({
    firstName: emp.firstName,
    today: workDate,
    shift: { name: emp.shift.name, label: shiftLabel(emp.shift) },
    onLeave: leave.has(workDate) || todayLog?.status === 'on_leave',
    todayLog,
    week: logs.filter((l) => l.workDate >= monday),
    summary,
  });
});

app.post('/clock-in', async (c) => {
  const { employeeId, companyId } = c.get('user');
  if (!employeeId) return c.json({ error: 'Your account is not linked to an employee.' }, 400);
  const db = getDb(c.env);
  const emp = await getEmployee(db, employeeId);
  if (!emp) return c.json({ error: 'Employee not found.' }, 404);

  const now = Date.now();
  const workDate = workDateFor(emp.shift, now);
  if ((await leaveDays(db, employeeId, workDate, workDate)).size) {
    return c.json({ error: "You're on approved leave today." }, 409);
  }
  const existing = await db.select().from(attendanceLogs)
    .where(and(eq(attendanceLogs.employeeId, employeeId), eq(attendanceLogs.workDate, workDate))).get();
  if (existing) {
    return c.json({ error: existing.status === 'on_leave' ? "You're on leave today." : "You've already clocked in for this shift." }, 409);
  }
  const status = isLate(emp.shift, workDate, now) ? 'late' : 'present';
  await db.insert(attendanceLogs).values({ companyId, employeeId, workDate, timeIn: new Date(now), status });
  return c.json({ ok: true, status, workDate });
});

// Clock out closes your open record, even if it started yesterday (night shift)
app.post('/clock-out', async (c) => {
  const { employeeId } = c.get('user');
  if (!employeeId) return c.json({ error: 'Your account is not linked to an employee.' }, 400);
  const db = getDb(c.env);
  const log = await db.select().from(attendanceLogs).where(and(
    eq(attendanceLogs.employeeId, employeeId),
    isNotNull(attendanceLogs.timeIn), isNull(attendanceLogs.timeOut),
    gte(attendanceLogs.workDate, addDays(manilaDate(), -1)),
  )).orderBy(desc(attendanceLogs.workDate)).get();
  if (!log) return c.json({ error: "You're not clocked in right now." }, 409);
  await db.update(attendanceLogs).set({ timeOut: new Date() }).where(eq(attendanceLogs.id, log.id));
  return c.json({ ok: true });
});

app.post('/undo-clock-out', async (c) => {
  const { employeeId } = c.get('user');
  if (!employeeId) return c.json({ error: 'Your account is not linked to an employee.' }, 400);
  const db = getDb(c.env);
  const log = await db.select().from(attendanceLogs).where(and(
    eq(attendanceLogs.employeeId, employeeId), isNotNull(attendanceLogs.timeOut),
    gte(attendanceLogs.workDate, addDays(manilaDate(), -1)),
  )).orderBy(desc(attendanceLogs.timeOut)).get();
  if (!log?.timeOut || Date.now() - log.timeOut.getTime() > UNDO_WINDOW) {
    return c.json({ error: 'Undo is only available for 5 minutes. Ask HR to correct your time.' }, 409);
  }
  await db.update(attendanceLogs).set({ timeOut: null }).where(eq(attendanceLogs.id, log.id));
  return c.json({ ok: true });
});

// Team view for one date
app.get('/team', requireRole('admin', 'finance', 'manager'), async (c) => {
  const user = c.get('user');
  const q = c.req.query('date');
  const now = Date.now();
  const today = manilaDate(now);
  const date = q && DATE_RE.test(q) ? q : today;
  const db = getDb(c.env);

  const conds = [
    eq(employees.companyId, user.companyId), ne(employees.status, 'resigned'), lte(employees.hireDate, date),
  ];
  if (user.role === 'manager') conds.push(eq(employees.managerId, user.employeeId ?? ''));

  const rows = await db.select({
    id: employees.id, firstName: employees.firstName, lastName: employees.lastName,
    department: departments.name, timeIn: attendanceLogs.timeIn, timeOut: attendanceLogs.timeOut,
    status: attendanceLogs.status, ...shiftCols,
  }).from(employees)
    .leftJoin(departments, eq(employees.departmentId, departments.id))
    .leftJoin(shifts, eq(employees.shiftId, shifts.id))
    .leftJoin(attendanceLogs, and(eq(attendanceLogs.employeeId, employees.id), eq(attendanceLogs.workDate, date)))
    .where(and(...conds))
    .orderBy(asc(employees.firstName), asc(employees.lastName));

  const noRecord = rows.filter((r) => !r.status).map((r) => r.id);
  const leaveIds = new Set(noRecord.length
    ? (await db.select({ employeeId: leaveRequests.employeeId }).from(leaveRequests).where(and(
      inArray(leaveRequests.employeeId, noRecord), eq(leaveRequests.status, 'approved'),
      lte(leaveRequests.startDate, date), gte(leaveRequests.endDate, date),
    ))).map((r) => r.employeeId)
    : []);

  const list = rows.map((r) => {
    const shift = toShift(r);
    let status: string = r.status ?? '';
    if (!status) {
      if (leaveIds.has(r.id)) status = 'on_leave';
      else if (isWeekend(date) || date > today) status = 'no_record';
      else if (now < shiftStartMs(shift, date)) status = 'upcoming';
      else if (now < shiftEndMs(shift, date)) status = 'not_in';
      else status = 'absent';
    }
    return {
      id: r.id, firstName: r.firstName, lastName: r.lastName, department: r.department,
      timeIn: r.timeIn, timeOut: r.timeOut, status, shift: shift.name, shiftLabel: shiftLabel(shift),
    };
  });
  const counts: Record<string, number> = {};
  for (const r of list) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return c.json({ date, today, employees: list, counts });
});

export default app;