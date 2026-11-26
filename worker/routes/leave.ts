import { Hono } from 'hono';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { departments, employees, leaveBalances, leaveRequests, leaveTypes } from '../db/schema';
import { type AppEnv, requireAuth, requireRole } from '../lib/session';

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';
const DAY = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Count Monday–Friday between two dates (inclusive)
function workdays(start: string, end: string) {
  let n = 0;
  for (let d = Date.parse(`${start}T00:00:00Z`); d <= Date.parse(`${end}T00:00:00Z`); d += DAY) {
    const w = new Date(d).getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

// Leave types for the request form
app.get('/types', async (c) => {
  const types = await getDb(c.env)
    .select({ id: leaveTypes.id, name: leaveTypes.name })
    .from(leaveTypes)
    .where(eq(leaveTypes.companyId, c.get('user').companyId))
    .orderBy(asc(leaveTypes.name));
  return c.json({ types });
});

// My balances and my requests
app.get('/my', async (c) => {
  const { employeeId } = c.get('user');
  if (!employeeId) return c.json({ balances: [], requests: [] });
  const db = getDb(c.env);
  const year = new Date().getUTCFullYear();
  const [balances, requests] = await Promise.all([
    db.select({
      leaveTypeId: leaveBalances.leaveTypeId, name: leaveTypes.name,
      allocated: leaveBalances.allocated, used: leaveBalances.used,
    }).from(leaveBalances).innerJoin(leaveTypes, eq(leaveBalances.leaveTypeId, leaveTypes.id))
      .where(and(eq(leaveBalances.employeeId, employeeId), eq(leaveBalances.year, year)))
      .orderBy(asc(leaveTypes.name)),
    db.select({
      id: leaveRequests.id, leaveTypeId: leaveRequests.leaveTypeId, type: leaveTypes.name,
      startDate: leaveRequests.startDate, endDate: leaveRequests.endDate, days: leaveRequests.days,
      status: leaveRequests.status, reason: leaveRequests.reason,
    }).from(leaveRequests).innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .where(eq(leaveRequests.employeeId, employeeId))
      .orderBy(desc(leaveRequests.startDate)).limit(20),
  ]);
  return c.json({ balances, requests });
});

// File a leave request
app.post('/', async (c) => {
  const user = c.get('user');
  if (!user.employeeId) return c.json({ error: 'Your account is not linked to an employee.' }, 400);
  const b = await c.req.json<{ leaveTypeId?: string; startDate?: string; endDate?: string; reason?: string }>()
    .catch(() => ({} as { leaveTypeId?: string; startDate?: string; endDate?: string; reason?: string }));

  if (!b.leaveTypeId) return c.json({ error: 'Choose a leave type.' }, 400);
  if (!b.startDate || !b.endDate || !DATE_RE.test(b.startDate) || !DATE_RE.test(b.endDate)) {
    return c.json({ error: 'Choose your dates.' }, 400);
  }
  if (b.endDate < b.startDate) return c.json({ error: "The end date can't be before the start date." }, 400);
  if (b.startDate.slice(0, 4) !== b.endDate.slice(0, 4)) {
    return c.json({ error: 'Split requests that cross into a new year.' }, 400);
  }
  const days = workdays(b.startDate, b.endDate);
  if (!days) return c.json({ error: 'Your dates fall on a weekend.' }, 400);

  const db = getDb(c.env);
  const type = await db.select().from(leaveTypes)
    .where(and(eq(leaveTypes.id, b.leaveTypeId), eq(leaveTypes.companyId, user.companyId))).get();
  if (!type) return c.json({ error: 'Choose a valid leave type.' }, 400);

  const overlap = await db.select({ id: leaveRequests.id }).from(leaveRequests).where(and(
    eq(leaveRequests.employeeId, user.employeeId),
    inArray(leaveRequests.status, ['pending', 'approved']),
    lte(leaveRequests.startDate, b.endDate),
    gte(leaveRequests.endDate, b.startDate),
  )).get();
  if (overlap) return c.json({ error: 'You already have leave on some of these dates.' }, 400);

  // Days left = allocated - used - still pending
  const year = Number(b.startDate.slice(0, 4));
  const bal = await db.select().from(leaveBalances).where(and(
    eq(leaveBalances.employeeId, user.employeeId),
    eq(leaveBalances.leaveTypeId, type.id),
    eq(leaveBalances.year, year),
  )).get();
  const pending = (await db.select({ total: sql<number>`coalesce(sum(${leaveRequests.days}), 0)` })
    .from(leaveRequests).where(and(
      eq(leaveRequests.employeeId, user.employeeId),
      eq(leaveRequests.leaveTypeId, type.id),
      eq(leaveRequests.status, 'pending'),
      sql`substr(${leaveRequests.startDate}, 1, 4) = ${String(year)}`,
    )).get())?.total ?? 0;
  const left = (bal?.allocated ?? 0) - (bal?.used ?? 0) - pending;
  if (days > left) {
    return c.json({
      error: `Not enough ${type.name.toLowerCase()} leave. You have ${left} ${left === 1 ? 'day' : 'days'} left.`,
    }, 400);
  }

  const [created] = await db.insert(leaveRequests).values({
    companyId: user.companyId, employeeId: user.employeeId, leaveTypeId: type.id,
    startDate: b.startDate, endDate: b.endDate, days, reason: b.reason?.trim() || null,
  }).returning({ id: leaveRequests.id });
  return c.json({ request: created }, 201);
});

// Requests to review: HR Admin sees everyone, managers see their team
app.get('/requests', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user');
  const status = (c.req.query('status') ?? 'pending') as Status;
  const db = getDb(c.env);
  const scope = [eq(leaveRequests.companyId, user.companyId)];
  if (user.role === 'manager') scope.push(eq(employees.managerId, user.employeeId ?? ''));

  const rows = await db.select({
    id: leaveRequests.id, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate,
    days: leaveRequests.days, reason: leaveRequests.reason, status: leaveRequests.status,
    leaveTypeId: leaveRequests.leaveTypeId, type: leaveTypes.name,
    employeeId: employees.id, firstName: employees.firstName, lastName: employees.lastName,
    department: departments.name,
  }).from(leaveRequests)
    .innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
    .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
    .leftJoin(departments, eq(employees.departmentId, departments.id))
    .where(and(...scope, eq(leaveRequests.status, status)))
    .orderBy(status === 'pending' ? asc(leaveRequests.startDate) : desc(leaveRequests.decidedAt));

  const countRows = await db.select({ status: leaveRequests.status, total: sql<number>`count(*)` })
    .from(leaveRequests).innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
    .where(and(...scope)).groupBy(leaveRequests.status);
  const counts = { pending: 0, approved: 0, rejected: 0 } as Record<string, number>;
  for (const r of countRows) counts[r.status] = r.total;

  // Attach "days left" for each person
  const ids = [...new Set(rows.map((r) => r.employeeId))];
  const balances = ids.length
    ? await db.select().from(leaveBalances).where(and(
      inArray(leaveBalances.employeeId, ids), eq(leaveBalances.year, new Date().getUTCFullYear()),
    ))
    : [];
  const requests = rows.map((r) => {
    const b = balances.find((x) => x.employeeId === r.employeeId && x.leaveTypeId === r.leaveTypeId);
    return { ...r, allocated: b?.allocated ?? null, left: b ? b.allocated - b.used : null };
  });
  return c.json({ requests, counts });
});

// Approve or reject
app.post('/:id/decide', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user');
  const { decision } = await c.req.json<{ decision?: string }>().catch(() => ({} as { decision?: string }));
  if (decision !== 'approved' && decision !== 'rejected') return c.json({ error: 'Choose approve or reject.' }, 400);

  const db = getDb(c.env);
  const req = await db.select({
    id: leaveRequests.id, employeeId: leaveRequests.employeeId, leaveTypeId: leaveRequests.leaveTypeId,
    startDate: leaveRequests.startDate, days: leaveRequests.days, status: leaveRequests.status,
    managerId: employees.managerId,
  }).from(leaveRequests).innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
    .where(and(eq(leaveRequests.id, c.req.param('id')), eq(leaveRequests.companyId, user.companyId))).get();

  if (!req) return c.json({ error: 'Request not found.' }, 404);
  if (req.employeeId === user.employeeId) return c.json({ error: "You can't approve your own request." }, 403);
  if (user.role === 'manager' && req.managerId !== user.employeeId) {
    return c.json({ error: "You can only review your team's requests." }, 403);
  }
  if (req.status !== 'pending') return c.json({ error: 'This request was already decided.' }, 409);

  const update = db.update(leaveRequests)
    .set({ status: decision, approverId: user.id, decidedAt: new Date() })
    .where(and(eq(leaveRequests.id, req.id), eq(leaveRequests.status, 'pending')));

  if (decision === 'approved') {
    await db.batch([
      update,
      db.update(leaveBalances).set({ used: sql`${leaveBalances.used} + ${req.days}` }).where(and(
        eq(leaveBalances.employeeId, req.employeeId),
        eq(leaveBalances.leaveTypeId, req.leaveTypeId),
        eq(leaveBalances.year, Number(req.startDate.slice(0, 4))),
      )),
    ]);
  } else {
    await update;
  }
  return c.json({ ok: true });
});

// Cancel my own pending request
app.post('/:id/cancel', async (c) => {
  const user = c.get('user');
  const db = getDb(c.env);
  const req = await db.select({ id: leaveRequests.id, status: leaveRequests.status }).from(leaveRequests)
    .where(and(eq(leaveRequests.id, c.req.param('id')), eq(leaveRequests.employeeId, user.employeeId ?? ''))).get();
  if (!req) return c.json({ error: 'Request not found.' }, 404);
  if (req.status !== 'pending') return c.json({ error: 'Only pending requests can be cancelled.' }, 409);
  await db.update(leaveRequests).set({ status: 'cancelled' }).where(eq(leaveRequests.id, req.id));
  return c.json({ ok: true });
});

export default app;