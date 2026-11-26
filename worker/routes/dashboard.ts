import { Hono } from 'hono';
import { and, asc, eq, gte, lte, ne } from 'drizzle-orm';
import { getDb } from '../db/client';
import { attendanceLogs, departments, employees, leaveRequests, leaveTypes } from '../db/schema';
import { type AppEnv, requireAuth, requireRole } from '../lib/session';
import { manilaDate } from '../lib/shifts';

const app = new Hono<AppEnv>();
app.use('*', requireAuth, requireRole('admin', 'finance', 'manager'));

app.get('/', async (c) => {
  const user = c.get('user');
  const db = getDb(c.env);
  const today = manilaDate();
  const monthStart = `${today.slice(0, 8)}01`;

  // HR and Finance see everyone, managers see their team
  const scope = [eq(employees.companyId, user.companyId), ne(employees.status, 'resigned')];
  if (user.role === 'manager') scope.push(eq(employees.managerId, user.employeeId ?? ''));
  const where = and(...scope);

  const [me, people, todayLogs, pending, leaveToday] = await Promise.all([
    user.employeeId
      ? db.select({ firstName: employees.firstName }).from(employees).where(eq(employees.id, user.employeeId)).get()
      : Promise.resolve(undefined),
    db.select({ id: employees.id, hireDate: employees.hireDate, department: departments.name })
      .from(employees).leftJoin(departments, eq(employees.departmentId, departments.id)).where(where),
    db.select({
      employeeId: attendanceLogs.employeeId, timeIn: attendanceLogs.timeIn, status: attendanceLogs.status,
      firstName: employees.firstName, lastName: employees.lastName, department: departments.name,
    }).from(attendanceLogs)
      .innerJoin(employees, eq(attendanceLogs.employeeId, employees.id))
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .where(and(where, eq(attendanceLogs.workDate, today))),
    db.select({
      id: leaveRequests.id, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate,
      days: leaveRequests.days, type: leaveTypes.name,
      firstName: employees.firstName, lastName: employees.lastName,
    }).from(leaveRequests)
      .innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
      .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .where(and(where, eq(leaveRequests.status, 'pending')))
      .orderBy(asc(leaveRequests.startDate)),
    db.select({
      employeeId: leaveRequests.employeeId, type: leaveTypes.name, endDate: leaveRequests.endDate,
      firstName: employees.firstName, lastName: employees.lastName,
    }).from(leaveRequests)
      .innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
      .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .where(and(where, eq(leaveRequests.status, 'approved'),
        lte(leaveRequests.startDate, today), gte(leaveRequests.endDate, today))),
  ]);

  const worked = todayLogs.filter((l) => l.status === 'present' || l.status === 'late');
  const onLeaveIds = new Set([
    ...leaveToday.map((l) => l.employeeId),
    ...todayLogs.filter((l) => l.status === 'on_leave').map((l) => l.employeeId),
  ]);

  const deptCounts = new Map<string, number>();
  for (const p of people) {
    const name = p.department ?? 'No department';
    deptCounts.set(name, (deptCounts.get(name) ?? 0) + 1);
  }

  return c.json({
    firstName: me?.firstName ?? '',
    today,
    stats: {
      employees: people.length,
      newThisMonth: people.filter((p) => p.hireDate >= monthStart).length,
      present: worked.length,
      late: worked.filter((l) => l.status === 'late').length,
      onLeave: onLeaveIds.size,
      pending: pending.length,
      notIn: Math.max(0, people.length - worked.length - onLeaveIds.size),
    },
    pending: pending.slice(0, 5),
    departments: [...deptCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    recentClockIns: [...worked]
      .sort((a, b) => (b.timeIn?.getTime() ?? 0) - (a.timeIn?.getTime() ?? 0))
      .slice(0, 6),
    onLeaveToday: [...new Map(leaveToday.map((l) => [l.employeeId, l])).values()].slice(0, 6),
  });
});

export default app;