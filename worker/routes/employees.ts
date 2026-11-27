import { Hono } from 'hono';
import { and, asc, desc, eq, getTableColumns, like, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { getDb } from '../db/client';
import {
    attendanceLogs, departments, employees, leaveBalances, leaveRequests, leaveTypes, positions, shifts,
} from '../db/schema';
import { type AppEnv, requireAuth, requireRole } from '../lib/session';

type DB = ReturnType<typeof getDb>;
const TYPES = ['regular', 'probationary', 'contractual'] as const;
const STATUSES = ['active', 'on_leave', 'resigned'] as const;

type EmployeeInput = {
  firstName: string; lastName: string; email: string; phone: string | null;
  departmentId: string | null; positionId: string | null; managerId: string | null; shiftId: string | null;
  employmentType: (typeof TYPES)[number]; status: (typeof STATUSES)[number]; hireDate: string;
  monthlyRate: number | null;
};

// Clean up and check what the form sent
function parseEmployee(body: Record<string, unknown>): { data: EmployeeInput } | { error: string } {
  const s = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
  const data: EmployeeInput = {
    firstName: s('firstName'), lastName: s('lastName'), email: s('email').toLowerCase(),
    phone: s('phone') || null, departmentId: s('departmentId') || null,
    positionId: s('positionId') || null, managerId: s('managerId') || null, shiftId: s('shiftId') || null, monthlyRate: s('monthlyRate') ? Number(s('monthlyRate')) : null,
    employmentType: s('employmentType') as EmployeeInput['employmentType'],
    status: (s('status') || 'active') as EmployeeInput['status'],
    hireDate: s('hireDate'),
  };
  if (!data.firstName || !data.lastName) return { error: 'Enter a first and last name.' };
  if (data.firstName.length > 60 || data.lastName.length > 60) return { error: 'Names can be up to 60 characters.' };
  if (data.email.length > 120 || (data.phone?.length ?? 0) > 20) return { error: 'Email or phone is too long.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return { error: 'Enter a valid email.' };
  if (!TYPES.includes(data.employmentType)) return { error: 'Choose an employment type.' };
  if (!STATUSES.includes(data.status)) return { error: 'Choose a status.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.hireDate)) return { error: 'Enter a hire date.' };
  if (data.monthlyRate !== null && (!Number.isFinite(data.monthlyRate) || data.monthlyRate < 0 || data.monthlyRate > 10_000_000)) {
    return { error: 'Enter a valid monthly rate.' };
  }
  return { data };
}

// Make sure department/position/manager belong to the same company, and email isn't taken
async function refsError(db: DB, companyId: string, d: EmployeeInput, selfId?: string) {
  if (d.departmentId && !(await db.select({ id: departments.id }).from(departments)
    .where(and(eq(departments.id, d.departmentId), eq(departments.companyId, companyId))).get())) {
    return 'Choose a valid department.';
  }
  if (d.positionId && !(await db.select({ id: positions.id }).from(positions)
    .where(and(eq(positions.id, d.positionId), eq(positions.companyId, companyId))).get())) {
    return 'Choose a valid position.';
  }
  if (d.managerId && (d.managerId === selfId || !(await db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.id, d.managerId), eq(employees.companyId, companyId))).get()))) {
    return 'Choose a valid manager.';
  }
  if (d.shiftId && !(await db.select({ id: shifts.id }).from(shifts)
    .where(and(eq(shifts.id, d.shiftId), eq(shifts.companyId, companyId))).get())) {
    return 'Choose a valid shift.';
  }
  const dup = await db.select({ id: employees.id }).from(employees)
    .where(and(
      eq(employees.companyId, companyId), eq(employees.email, d.email),
      selfId ? ne(employees.id, selfId) : undefined,
    )).get();
  if (dup) return 'Another employee already uses this email.';
  return null;
}

const app = new Hono<AppEnv>();
app.use('*', requireAuth);
const manager = alias(employees, 'manager');

// Dropdown options for the form and filters
app.get('/meta', requireRole('admin', 'finance'), async (c) => {
  const { companyId } = c.get('user');
  const db = getDb(c.env);
  const [depts, pos, people, shiftList] = await Promise.all([
    db.select({ id: departments.id, name: departments.name }).from(departments)
      .where(eq(departments.companyId, companyId)).orderBy(asc(departments.name)),
    db.select({ id: positions.id, title: positions.title }).from(positions)
      .where(eq(positions.companyId, companyId)).orderBy(asc(positions.title)),
    db.select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
      .from(employees)
      .where(and(eq(employees.companyId, companyId), ne(employees.status, 'resigned')))
      .orderBy(asc(employees.firstName)),
    db.select({ id: shifts.id, name: shifts.name }).from(shifts)
      .where(eq(shifts.companyId, companyId)).orderBy(asc(shifts.startMinute)),
  ]);
 return c.json({ departments: depts, positions: pos, managers: people, shifts: shiftList });
});

// List with search + department filter
app.get('/', requireRole('admin', 'finance'), async (c) => {
  const { companyId } = c.get('user');
  const q = c.req.query('q')?.trim();
  const dept = c.req.query('dept');
  const conds = [eq(employees.companyId, companyId)];
  if (dept) conds.push(eq(employees.departmentId, dept));
  if (q) {
    const p = `%${q}%`;
    conds.push(or(
      like(employees.firstName, p), like(employees.lastName, p),
      like(employees.email, p), like(positions.title, p),
    )!);
  }
  const rows = await getDb(c.env)
    .select({
      id: employees.id, employeeNo: employees.employeeNo,
      firstName: employees.firstName, lastName: employees.lastName, email: employees.email,
      employmentType: employees.employmentType, status: employees.status, hireDate: employees.hireDate,
      department: departments.name, position: positions.title, shift: shifts.name,
    })
    .from(employees)
    .leftJoin(departments, eq(employees.departmentId, departments.id))
    .leftJoin(positions, eq(employees.positionId, positions.id))
    .leftJoin(shifts, eq(employees.shiftId, shifts.id))
    .where(and(...conds))
    .orderBy(asc(employees.firstName), asc(employees.lastName));
  return c.json({ employees: rows });
});

// Profile: HR/Finance see anyone, employees only themselves
app.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!['admin', 'finance'].includes(user.role) && user.employeeId !== id) {
    return c.json({ error: "You don't have access to this." }, 403);
  }
  const db = getDb(c.env);
  const employee = await db
    .select({
      ...getTableColumns(employees),
      department: departments.name, position: positions.title,
      shift: shifts.name,
      managerFirstName: manager.firstName, managerLastName: manager.lastName,
    })
    .from(employees)
    .leftJoin(departments, eq(employees.departmentId, departments.id))
    .leftJoin(positions, eq(employees.positionId, positions.id))
    .leftJoin(shifts, eq(employees.shiftId, shifts.id))   
    .leftJoin(manager, eq(employees.managerId, manager.id))
    .where(and(eq(employees.id, id), eq(employees.companyId, user.companyId)))
    .get();
  if (!employee) return c.json({ error: 'Employee not found.' }, 404);

  const year = new Date().getUTCFullYear();
  const [balances, attendance, leave] = await Promise.all([
    db.select({ name: leaveTypes.name, allocated: leaveBalances.allocated, used: leaveBalances.used })
      .from(leaveBalances).innerJoin(leaveTypes, eq(leaveBalances.leaveTypeId, leaveTypes.id))
      .where(and(eq(leaveBalances.employeeId, id), eq(leaveBalances.year, year)))
      .orderBy(asc(leaveTypes.name)),
    db.select({
      workDate: attendanceLogs.workDate, timeIn: attendanceLogs.timeIn,
      timeOut: attendanceLogs.timeOut, status: attendanceLogs.status,
    }).from(attendanceLogs).where(eq(attendanceLogs.employeeId, id))
      .orderBy(desc(attendanceLogs.workDate)).limit(10),
    db.select({
      id: leaveRequests.id, type: leaveTypes.name, startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate, days: leaveRequests.days,
      status: leaveRequests.status, reason: leaveRequests.reason,
    }).from(leaveRequests).innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .where(eq(leaveRequests.employeeId, id)).orderBy(desc(leaveRequests.startDate)).limit(10),
  ]);
  return c.json({ employee, balances, attendance, leave });
});

// Add employee (HR Admin only)
app.post('/', requireRole('admin'), async (c) => {
  const { companyId } = c.get('user');
  const db = getDb(c.env);
  const parsed = parseEmployee(await c.req.json<Record<string, unknown>>().catch(() => ({})));
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const problem = await refsError(db, companyId, parsed.data);
  if (problem) return c.json({ error: problem }, 400);

  const { total } = (await db.select({ total: sql<number>`count(*)` }).from(employees)
    .where(eq(employees.companyId, companyId)).get())!;
    if (c.env.DEMO_MODE === 'true' && total >= 60) {
    return c.json({ error: 'The demo is limited to 60 employees. It resets every night.' }, 403);
  }
  const id = crypto.randomUUID();
  await db.insert(employees).values({
    ...parsed.data, id, companyId, employeeNo: `EMP-${String(total + 1).padStart(3, '0')}`,
  });

  // Give the new hire this year's leave balances
  const types = await db.select().from(leaveTypes).where(eq(leaveTypes.companyId, companyId));
  if (types.length) {
    const year = new Date().getUTCFullYear();
    await db.insert(leaveBalances).values(types.map((t) => ({
      employeeId: id, leaveTypeId: t.id, year, allocated: t.defaultDays, used: 0,
    })));
  }
  return c.json({ employee: { id } }, 201);
});

// Edit employee (HR Admin only)
app.put('/:id', requireRole('admin'), async (c) => {
  const { companyId } = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env);
  const exists = await db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.id, id), eq(employees.companyId, companyId))).get();
  if (!exists) return c.json({ error: 'Employee not found.' }, 404);

  const parsed = parseEmployee(await c.req.json<Record<string, unknown>>().catch(() => ({})));
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const problem = await refsError(db, companyId, parsed.data, id);
  if (problem) return c.json({ error: problem }, 400);

  await db.update(employees).set(parsed.data)
    .where(and(eq(employees.id, id), eq(employees.companyId, companyId)));
  return c.json({ ok: true });
});

export default app;