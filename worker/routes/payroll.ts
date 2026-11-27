import { Hono } from 'hono';
import { and, asc, desc, eq, getTableColumns, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { getDb } from '../db/client';
import {
  attendanceLogs, companies, departments, employees, leaveRequests, payRuns, payslips, positions, shifts,
} from '../db/schema';
import { type AppEnv, requireAuth, requireRole } from '../lib/session';
import { type Adjustment, type DayLog, RATES_YEAR, computePay, round2 } from '../lib/payroll';
import { DEFAULT_SHIFT, addDays, manilaDate } from '../lib/shifts';

type DB = ReturnType<typeof getDb>;
type Run = typeof payRuns.$inferSelect;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['allowance', 'bonus', 'overtime', 'deduction'];

function parseAdjustments(raw: unknown): Adjustment[] | string {
  if (!Array.isArray(raw)) return 'Send a list of items.';
  if (raw.length > 20) return 'Up to 20 items per payslip.';
  const out: Adjustment[] = [];
  for (const r of raw) {
    const a = r as Record<string, unknown>;
    const kind = String(a.kind ?? '');
    const label = String(a.label ?? '').trim().slice(0, 60);
    if (!KINDS.includes(kind)) return 'Choose an item type.';
    if (!label) return 'Give each item a name.';
    if (kind === 'overtime') {
      const hours = Number(a.hours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 200) return 'Enter overtime hours between 0 and 200.';
      out.push({ kind: 'overtime', label, hours: round2(hours) });
    } else {
      const amount = Number(a.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return 'Enter an amount greater than 0.';
      out.push({ kind: kind as Adjustment['kind'], label, amount: round2(amount) });
    }
  }
  return out;
}

// Everything the engine needs for a period: salary, shift, attendance, approved leave
async function loadPeriod(db: DB, companyId: string, from: string, to: string, employeeIds?: string[]) {
  const conds = [eq(employees.companyId, companyId), ne(employees.status, 'resigned'), lte(employees.hireDate, to)];
  if (employeeIds) conds.push(inArray(employees.id, employeeIds));
  const [emps, logs, leaves] = await Promise.all([
    db.select({
      id: employees.id, hireDate: employees.hireDate, monthlyRate: employees.monthlyRate,
      shiftId: shifts.id, shiftName: shifts.name, startMinute: shifts.startMinute,
      endMinute: shifts.endMinute, graceMinutes: shifts.graceMinutes,
    }).from(employees).leftJoin(shifts, eq(employees.shiftId, shifts.id)).where(and(...conds)),
    db.select({
      employeeId: attendanceLogs.employeeId, workDate: attendanceLogs.workDate,
      timeIn: attendanceLogs.timeIn, timeOut: attendanceLogs.timeOut, status: attendanceLogs.status,
    }).from(attendanceLogs).where(and(
      eq(attendanceLogs.companyId, companyId), gte(attendanceLogs.workDate, from), lte(attendanceLogs.workDate, to),
    )),
    db.select({ employeeId: leaveRequests.employeeId, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate })
      .from(leaveRequests).where(and(
        eq(leaveRequests.companyId, companyId), eq(leaveRequests.status, 'approved'),
        lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from),
      )),
  ]);
  return emps.filter((e) => (e.monthlyRate ?? 0) > 0).map((e) => {
    const leaveDates = new Set<string>();
    for (const l of leaves) {
      if (l.employeeId !== e.id) continue;
      const end = l.endDate > to ? to : l.endDate;
      for (let d = l.startDate < from ? from : l.startDate; d <= end; d = addDays(d, 1)) leaveDates.add(d);
    }
    return {
      id: e.id, monthlyRate: e.monthlyRate!, hireDate: e.hireDate, leaveDates,
      shift: e.shiftId
        ? { id: e.shiftId, name: e.shiftName!, startMinute: e.startMinute!, endMinute: e.endMinute!, graceMinutes: e.graceMinutes! }
        : DEFAULT_SHIFT,
      logs: logs.filter((l) => l.employeeId === e.id) as DayLog[],
    };
  });
}

type Person = Awaited<ReturnType<typeof loadPeriod>>[number];
function payslipRow(run: Run, p: Person, adjustments: Adjustment[]) {
  const r = computePay({
    ...p, periodStart: run.periodStart, periodEnd: run.periodEnd, today: manilaDate(), adjustments,
  });
  return {
    gross: r.gross, taxable: r.taxable, totalDeductions: r.totalDeductions, net: r.net, monthlyRate: p.monthlyRate,
    lines: JSON.stringify({ lines: r.lines, summary: r.summary, employerShare: r.employerShare }),
    adjustments: JSON.stringify(adjustments),
  };
}

// (Re)build every payslip in a draft run, keeping manual items
async function writePayslips(db: DB, run: Run, keep = new Map<string, Adjustment[]>()) {
  const people = await loadPeriod(db, run.companyId, run.periodStart, run.periodEnd);
  const rows = people.map((p) => ({
    id: crypto.randomUUID(), payRunId: run.id, companyId: run.companyId, employeeId: p.id,
    ...payslipRow(run, p, keep.get(p.id) ?? []),
  }));
  const stmts: BatchItem<'sqlite'>[] = [db.delete(payslips).where(eq(payslips.payRunId, run.id))];
  for (let i = 0; i < rows.length; i += 8) stmts.push(db.insert(payslips).values(rows.slice(i, i + 8)));
  stmts.push(db.update(payRuns).set({
    totalGross: round2(rows.reduce((s, r) => s + r.gross, 0)),
    totalNet: round2(rows.reduce((s, r) => s + r.net, 0)),
  }).where(eq(payRuns.id, run.id)));
  await db.batch(stmts as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}

const getRun = (db: DB, id: string, companyId: string) =>
  db.select().from(payRuns).where(and(eq(payRuns.id, id), eq(payRuns.companyId, companyId))).get();

const app = new Hono<AppEnv>();
app.use('*', requireAuth);
const finance = requireRole('admin', 'finance');

// All pay runs
app.get('/runs', finance, async (c) => {
  const runs = await getDb(c.env).select({
    ...getTableColumns(payRuns),
    people: sql<number>`(select count(*) from ${payslips} where ${payslips.payRunId} = ${payRuns.id})`,
  }).from(payRuns).where(eq(payRuns.companyId, c.get('user').companyId)).orderBy(desc(payRuns.periodStart));
  return c.json({ runs, ratesYear: RATES_YEAR, today: manilaDate() });
});

// Create a draft pay run and compute everyone
app.post('/runs', finance, async (c) => {
  const user = c.get('user');
  const db = getDb(c.env);
  const b = await c.req.json<{ periodStart?: string; periodEnd?: string; payDate?: string }>()
    .catch(() => ({} as { periodStart?: string; periodEnd?: string; payDate?: string }));
  if (![b.periodStart, b.periodEnd, b.payDate].every((d) => d && DATE_RE.test(d))) {
    return c.json({ error: 'Choose the period and pay date.' }, 400);
  }
  const { periodStart, periodEnd, payDate } = b as { periodStart: string; periodEnd: string; payDate: string };
  if (periodEnd < periodStart) return c.json({ error: "The end date can't be before the start date." }, 400);
  if ((Date.parse(periodEnd) - Date.parse(periodStart)) / 86_400_000 > 16) {
    return c.json({ error: 'A semi-monthly pay period can be up to 16 days.' }, 400);
  }
  const exists = await db.select({ id: payRuns.id }).from(payRuns).where(and(
    eq(payRuns.companyId, user.companyId), eq(payRuns.periodStart, periodStart), eq(payRuns.periodEnd, periodEnd),
  )).get();
  if (exists) return c.json({ error: 'A pay run for this period already exists.', id: exists.id }, 409);

  const id = crypto.randomUUID();
  await db.insert(payRuns).values({ id, companyId: user.companyId, periodStart, periodEnd, payDate, createdBy: user.id });
  await writePayslips(db, (await getRun(db, id, user.companyId))!);
  return c.json({ run: { id } }, 201);
});

// One pay run with all payslips
app.get('/runs/:id', finance, async (c) => {
  const db = getDb(c.env);
  const run = await getRun(db, c.req.param('id'), c.get('user').companyId);
  if (!run) return c.json({ error: 'Pay run not found.' }, 404);
  const rows = await db.select({
    id: payslips.id, employeeId: payslips.employeeId, monthlyRate: payslips.monthlyRate,
    gross: payslips.gross, taxable: payslips.taxable, totalDeductions: payslips.totalDeductions, net: payslips.net,
    lines: payslips.lines, adjustments: payslips.adjustments,
    firstName: employees.firstName, lastName: employees.lastName, employeeNo: employees.employeeNo,
    department: departments.name, shift: shifts.name,
  }).from(payslips)
    .innerJoin(employees, eq(payslips.employeeId, employees.id))
    .leftJoin(departments, eq(employees.departmentId, departments.id))
    .leftJoin(shifts, eq(employees.shiftId, shifts.id))
    .where(eq(payslips.payRunId, run.id))
    .orderBy(asc(employees.firstName), asc(employees.lastName));

  const list = rows.map(({ lines, adjustments, ...r }) => ({
    ...r, details: JSON.parse(lines), adjustments: JSON.parse(adjustments) as Adjustment[],
  }));
  return c.json({
    run, ratesYear: RATES_YEAR, payslips: list,
    totals: {
      gross: run.totalGross, net: run.totalNet,
      deductions: round2(list.reduce((s, p) => s + p.totalDeductions, 0)),
      employer: round2(list.reduce((s, p) => s + (p.details.employerShare ?? 0), 0)),
    },
  });
});

// Recompute from the latest attendance and leave, keeping manual items
app.post('/runs/:id/recalculate', finance, async (c) => {
  const db = getDb(c.env);
  const run = await getRun(db, c.req.param('id'), c.get('user').companyId);
  if (!run) return c.json({ error: 'Pay run not found.' }, 404);
  if (run.status !== 'draft') return c.json({ error: 'Finalized pay runs can’t be changed.' }, 409);
  const existing = await db.select({ employeeId: payslips.employeeId, adjustments: payslips.adjustments })
    .from(payslips).where(eq(payslips.payRunId, run.id));
  await writePayslips(db, run, new Map(existing.map((e) => [e.employeeId, JSON.parse(e.adjustments) as Adjustment[]])));
  return c.json({ ok: true });
});

// Save manual items for one payslip
app.put('/payslips/:id/adjustments', finance, async (c) => {
  const { companyId } = c.get('user');
  const db = getDb(c.env);
  const slip = await db.select().from(payslips)
    .where(and(eq(payslips.id, c.req.param('id')), eq(payslips.companyId, companyId))).get();
  if (!slip) return c.json({ error: 'Payslip not found.' }, 404);
  const run = (await getRun(db, slip.payRunId, companyId))!;
  if (run.status !== 'draft') return c.json({ error: 'Finalized pay runs can’t be changed.' }, 409);

  const body = await c.req.json<{ adjustments?: unknown }>().catch(() => ({} as { adjustments?: unknown }));
  const adjustments = parseAdjustments(body.adjustments);
  if (typeof adjustments === 'string') return c.json({ error: adjustments }, 400);

  const [person] = await loadPeriod(db, companyId, run.periodStart, run.periodEnd, [slip.employeeId]);
  if (!person) return c.json({ error: 'This employee has no monthly rate.' }, 400);
  const row = payslipRow(run, person, adjustments);
  await db.update(payslips).set(row).where(eq(payslips.id, slip.id));

  const t = await db.select({
    gross: sql<number>`coalesce(sum(${payslips.gross}), 0)`, net: sql<number>`coalesce(sum(${payslips.net}), 0)`,
  }).from(payslips).where(eq(payslips.payRunId, run.id)).get();
  await db.update(payRuns).set({ totalGross: round2(t?.gross ?? 0), totalNet: round2(t?.net ?? 0) }).where(eq(payRuns.id, run.id));
  return c.json({ ok: true });
});

app.post('/runs/:id/finalize', finance, async (c) => {
  const db = getDb(c.env);
  const run = await getRun(db, c.req.param('id'), c.get('user').companyId);
  if (!run) return c.json({ error: 'Pay run not found.' }, 404);
  if (run.status !== 'draft') return c.json({ error: 'This pay run is already finalized.' }, 409);
  await db.update(payRuns).set({ status: 'finalized', finalizedAt: new Date() }).where(eq(payRuns.id, run.id));
  return c.json({ ok: true });
});

app.delete('/runs/:id', finance, async (c) => {
  const db = getDb(c.env);
  const run = await getRun(db, c.req.param('id'), c.get('user').companyId);
  if (!run) return c.json({ error: 'Pay run not found.' }, 404);
  if (run.status !== 'draft') return c.json({ error: 'Finalized pay runs can’t be deleted.' }, 409);
  await db.batch([
    db.delete(payslips).where(eq(payslips.payRunId, run.id)),
    db.delete(payRuns).where(eq(payRuns.id, run.id)),
  ]);
  return c.json({ ok: true });
});

// Employee: my released payslips
app.get('/my', async (c) => {
  const { employeeId } = c.get('user');
  if (!employeeId) return c.json({ payslips: [] });
  const list = await getDb(c.env).select({
    id: payslips.id, periodStart: payRuns.periodStart, periodEnd: payRuns.periodEnd,
    payDate: payRuns.payDate, gross: payslips.gross, net: payslips.net,
  }).from(payslips).innerJoin(payRuns, eq(payslips.payRunId, payRuns.id))
    .where(and(eq(payslips.employeeId, employeeId), eq(payRuns.status, 'finalized')))
    .orderBy(desc(payRuns.periodStart));
  return c.json({ payslips: list });
});

// One payslip (yours once released, or anyone's for HR/Finance)
app.get('/payslips/:id', async (c) => {
  const user = c.get('user');
  const row = await getDb(c.env).select({
    ...getTableColumns(payslips),
    periodStart: payRuns.periodStart, periodEnd: payRuns.periodEnd, payDate: payRuns.payDate, status: payRuns.status,
    firstName: employees.firstName, lastName: employees.lastName, employeeNo: employees.employeeNo,
    position: positions.title, department: departments.name, company: companies.name,
  }).from(payslips)
    .innerJoin(payRuns, eq(payslips.payRunId, payRuns.id))
    .innerJoin(employees, eq(payslips.employeeId, employees.id))
    .innerJoin(companies, eq(payslips.companyId, companies.id))
    .leftJoin(positions, eq(employees.positionId, positions.id))
    .leftJoin(departments, eq(employees.departmentId, departments.id))
    .where(and(eq(payslips.id, c.req.param('id')), eq(payslips.companyId, user.companyId))).get();
  const isFinance = user.role === 'admin' || user.role === 'finance';
  if (!row || (!isFinance && (row.employeeId !== user.employeeId || row.status !== 'finalized'))) {
    return c.json({ error: 'Payslip not found.' }, 404);
  }
  const { lines, adjustments, ...rest } = row;
  return c.json({ payslip: { ...rest, details: JSON.parse(lines), adjustments: JSON.parse(adjustments) }, ratesYear: RATES_YEAR });
});

export default app;