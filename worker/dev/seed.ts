import { getTableColumns } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { getDb } from '../db/client';
import * as t from '../db/schema';
import { hashPassword } from '../lib/password';

type DB = ReturnType<typeof getDb>;
type Dept = 'Operations' | 'Sales' | 'IT' | 'Finance' | 'HR';
type EmpType = 'regular' | 'probationary' | 'contractual';
type LeaveName = 'Vacation' | 'Sick' | 'Emergency';
type Status = 'pending' | 'approved' | 'rejected';

const DEPTS: Dept[] = ['Operations', 'Sales', 'IT', 'Finance', 'HR'];

// The first 5 people are the department heads.
const PEOPLE: [string, string, Dept, string, EmpType, string][] = [
  ['Maria', 'Santos', 'HR', 'HR Manager', 'regular', '2019-06-03'],
  ['Ramon', 'Villanueva', 'Operations', 'Operations Head', 'regular', '2018-02-12'],
  ['Paolo', 'Ramos', 'Sales', 'Sales Manager', 'regular', '2019-11-04'],
  ['Liza', 'Bautista', 'Finance', 'Finance Manager', 'regular', '2020-08-17'],
  ['Arnel', 'Tan', 'IT', 'IT Lead', 'regular', '2021-01-11'],
  ['Juan', 'Dela Cruz', 'Operations', 'Warehouse Supervisor', 'regular', '2021-03-08'],
  ['Mark', 'Garcia', 'Operations', 'Warehouse Staff', 'probationary', '2026-09-01'],
  ['Noel', 'Aquino', 'Operations', 'Delivery Driver', 'regular', '2022-05-16'],
  ['Rachel', 'Lim', 'Operations', 'Inventory Clerk', 'regular', '2023-02-06'],
  ['Jun', 'Reyes', 'Operations', 'Delivery Driver', 'contractual', '2026-07-01'],
  ['Christine', 'Flores', 'Operations', 'Operations Assistant', 'regular', '2024-04-15'],
  ['Ana', 'Reyes', 'Sales', 'Sales Associate', 'regular', '2022-06-13'],
  ['Kim', 'Torres', 'Sales', 'Sales Associate', 'regular', '2023-09-18'],
  ['Rina', 'Castro', 'Sales', 'Account Executive', 'regular', '2021-10-04'],
  ['Bea', 'Mercado', 'Sales', 'Sales Associate', 'probationary', '2026-08-03'],
  ['Joshua', 'Navarro', 'Sales', 'Account Executive', 'regular', '2024-01-22'],
  ['Carlo', 'Mendoza', 'IT', 'Web Developer', 'regular', '2023-01-09'],
  ['Leo', 'Santiago', 'IT', 'IT Support', 'regular', '2022-11-14'],
  ['Joy', 'Fernandez', 'IT', 'IT Support', 'contractual', '2026-07-20'],
  ['Jasmine', 'Cruz', 'Finance', 'Accountant', 'regular', '2021-05-24'],
  ['Mike', 'Domingo', 'Finance', 'Payroll Officer', 'regular', '2022-08-08'],
  ['Ella', 'Gonzales', 'Finance', 'Accounting Clerk', 'regular', '2025-03-03'],
  ['Grace', 'Villanueva', 'HR', 'HR Officer', 'regular', '2022-02-14'],
  ['Patrick', 'Uy', 'HR', 'Recruitment Specialist', 'regular', '2024-06-10'],
  ['Sheila', 'Ramos', 'HR', 'HR Assistant', 'probationary', '2026-10-01'],
];

const DEMO_USERS = [
  ['admin', 'Maria Santos'],
  ['finance', 'Liza Bautista'],
  ['manager', 'Paolo Ramos'],
  ['employee', 'Juan Dela Cruz'],
] as const;

const LEAVE_TYPES: [LeaveName, number][] = [['Vacation', 15], ['Sick', 10], ['Emergency', 3]];

// [employee, type, start offset (days from today), end offset, status, reason]
const REQUESTS: [string, LeaveName, number, number, Status, string][] = [
  ['Carlo Mendoza', 'Vacation', -1, 2, 'approved', 'Family trip to Bohol'],
  ['Grace Villanueva', 'Sick', 0, 0, 'approved', 'Fever, will send med cert'],
  ['Ana Reyes', 'Vacation', 5, 7, 'pending', "Sister's wedding in Davao"],
  ['Kim Torres', 'Emergency', 1, 1, 'pending', 'Family emergency'],
  ['Mark Garcia', 'Sick', 2, 2, 'pending', 'Dental procedure'],
  ['Jasmine Cruz', 'Vacation', 14, 18, 'pending', 'Christmas vacation'],
  ['Rina Castro', 'Vacation', -12, -11, 'approved', 'Personal errands'],
  ['Leo Santiago', 'Vacation', -20, -18, 'approved', 'Hometown visit'],
  ['Juan Dela Cruz', 'Sick', -9, -9, 'approved', 'Flu'],
  ['Ramon Villanueva', 'Vacation', -25, -23, 'approved', 'Anniversary trip'],
  ['Noel Aquino', 'Emergency', -6, -6, 'rejected', 'Personal matter'],
  ['Bea Mercado', 'Vacation', -3, -2, 'rejected', 'Concert in Manila'],
];

// Small helpers
const DAY = 86_400_000;
const MNL = 8 * 3_600_000; // Manila is UTC+8
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isWeekday = (ms: number) => ![0, 6].includes(new Date(ms).getUTCDay());
const at = (dayMs: number, minutes: number) => new Date(dayMs + minutes * 60_000 - MNL);
const workdays = (from: number, to: number) => {
  let n = 0;
  for (let d = from; d <= to; d += DAY) if (isWeekday(d)) n++;
  return n;
};
// Repeatable "random" numbers, so the demo looks the same after every reset
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

export async function seedDemo(db: DB, opts: { reset?: boolean } = {}) {
  if (opts.reset) {
    await db.batch([
      db.delete(t.sessions), db.delete(t.documents), db.delete(t.attendanceLogs),
      db.delete(t.leaveRequests), db.delete(t.leaveBalances), db.delete(t.leaveTypes),
      db.delete(t.users), db.delete(t.employees), db.delete(t.positions),
      db.delete(t.departments), db.delete(t.companies),
    ]);
  } else if (await db.select().from(t.companies).get()) {
    return { created: false, message: 'Already set up. Use ?reset=1 to start over.' };
  }

  const r = rng(2026);
  const uuid = () => crypto.randomUUID();
  const now = Date.now();
  const nowManila = new Date(now + MNL);
  const today = Date.UTC(nowManila.getUTCFullYear(), nowManila.getUTCMonth(), nowManila.getUTCDate());
  const nowMin = Math.floor((now + MNL - today) / 60_000);
  const companyId = uuid();

  // Company, departments, positions
  const deptId = Object.fromEntries(DEPTS.map((d) => [d, uuid()])) as Record<Dept, string>;
  const titles = [...new Set(PEOPLE.map((p) => p[3]))];
  const positionId = Object.fromEntries(titles.map((title) => [title, uuid()]));

  // Employees (heads first, so manager links always point to an earlier row)
  const ids = PEOPLE.map(() => uuid());
  const headOf = Object.fromEntries(PEOPLE.slice(0, 5).map((p, i) => [p[2], ids[i]])) as Record<Dept, string>;
  const emps = PEOPLE.map(([first, last, dept, title, type, hire], i) => ({
    id: ids[i],
    companyId,
    employeeNo: `EMP-${String(i + 1).padStart(3, '0')}`,
    firstName: first,
    lastName: last,
    email: `${first}.${last}`.toLowerCase().replace(/\s+/g, '') + '@sunrise.ph',
    phone: `09${Math.floor(100_000_000 + r() * 899_999_999)}`,
    departmentId: deptId[dept],
    positionId: positionId[title],
    managerId: i < 5 ? null : headOf[dept],
    employmentType: type,
    status: 'active' as 'active' | 'on_leave',
    hireDate: hire,
  }));
  const byName = new Map(emps.map((e) => [`${e.firstName} ${e.lastName}`, e]));
  const deptOf = new Map(PEOPLE.map((p, i) => [ids[i], p[2]]));

  // Demo login accounts (one hash, same password for all demo users)
  const hash = await hashPassword('demo1234');
  const users = DEMO_USERS.map(([role, name]) => ({
    id: uuid(), companyId, employeeId: byName.get(name)!.id,
    email: `${role}@demo.ph`, passwordHash: hash, role,
  }));
  const userId = (role: string) => users.find((u) => u.role === role)!.id;

  // Leave types, requests, and who is on leave which day
  const typeId = Object.fromEntries(LEAVE_TYPES.map(([name]) => [name, uuid()])) as Record<LeaveName, string>;
  const onLeave = new Set<string>();
  const usedDays = new Map<string, number>();

  const requests = REQUESTS.map(([name, type, s, e, status, reason]) => {
    const emp = byName.get(name)!;
    const start = today + s * DAY;
    const end = today + e * DAY;
    const days = Math.max(1, workdays(start, end));
    if (status === 'approved') {
      for (let d = start; d <= end; d += DAY) onLeave.add(`${emp.id}|${ymd(d)}`);
      const key = `${emp.id}|${type}`;
      usedDays.set(key, (usedDays.get(key) ?? 0) + days);
      if (s <= 0 && e >= 0) emp.status = 'on_leave';
    }
    const decided = status !== 'pending';
    return {
      id: uuid(), companyId, employeeId: emp.id, leaveTypeId: typeId[type],
      startDate: ymd(start), endDate: ymd(end), days, reason, status,
      approverId: decided ? userId(deptOf.get(emp.id) === 'Sales' ? 'manager' : 'admin') : null,
      decidedAt: decided ? new Date(start - 3 * DAY) : null,
      createdAt: new Date(Math.min(start - 5 * DAY, now - DAY)),
    };
  });

  const year = new Date(today).getUTCFullYear();
  const balances = emps.flatMap((emp) =>
    LEAVE_TYPES.map(([name, allocated]) => ({
      id: uuid(), employeeId: emp.id, leaveTypeId: typeId[name], year, allocated,
      used: (usedDays.get(`${emp.id}|${name}`) ?? 0)
        + (name === 'Vacation' ? Math.floor(r() * 4) : name === 'Sick' ? Math.floor(r() * 2) : 0),
    })),
  );

  // Attendance for the last ~30 days, plus today so far
  const juanId = byName.get('Juan Dela Cruz')!.id;
  const attendance: (typeof t.attendanceLogs.$inferInsert)[] = [];
  for (let off = -30; off <= 0; off++) {
    const day = today + off * DAY;
    if (!isWeekday(day)) continue;
    const date = ymd(day);
    for (const emp of emps) {
      if (emp.hireDate > date) continue;
      if (onLeave.has(`${emp.id}|${date}`)) {
        attendance.push({ id: uuid(), companyId, employeeId: emp.id, workDate: date, status: 'on_leave' });
        continue;
      }
      const roll = r();
      const late = roll < 0.18;
      const inMin = late ? 8 * 60 + 1 + Math.floor(r() * 35) : 7 * 60 + 35 + Math.floor(r() * 25);
      const outMin = 17 * 60 + Math.floor(r() * 40);
      if (off === 0) {
        if (emp.id === juanId || inMin > nowMin) continue; // Juan clocks in himself
        attendance.push({ id: uuid(), companyId, employeeId: emp.id, workDate: date,
          timeIn: at(day, inMin), status: late ? 'late' : 'present' });
        continue;
      }
      if (roll > 0.96) {
        attendance.push({ id: uuid(), companyId, employeeId: emp.id, workDate: date, status: 'absent' });
        continue;
      }
      attendance.push({ id: uuid(), companyId, employeeId: emp.id, workDate: date,
        timeIn: at(day, inMin), timeOut: at(day, outMin), status: late ? 'late' : 'present' });
    }
  }

  // Insert everything in one batch (D1 allows max 100 values per query, so we chunk)
  const stmts: BatchItem<'sqlite'>[] = [];
  const add = <T extends SQLiteTable>(table: T, rows: T['$inferInsert'][]) => {
    const size = Math.max(1, Math.floor(100 / Object.keys(getTableColumns(table)).length));
    for (let i = 0; i < rows.length; i += size) {
      stmts.push(db.insert(table).values(rows.slice(i, i + size) as never) as unknown as BatchItem<'sqlite'>);
    }
  };
  add(t.companies, [{ id: companyId, name: 'Sunrise Trading (Demo)' }]);
  add(t.departments, DEPTS.map((d) => ({ id: deptId[d], companyId, name: d })));
  add(t.positions, titles.map((title) => ({ id: positionId[title], companyId, title })));
  add(t.employees, emps);
  add(t.users, users);
  add(t.leaveTypes, LEAVE_TYPES.map(([name, days]) => ({ id: typeId[name], companyId, name, defaultDays: days })));
  add(t.leaveBalances, balances);
  add(t.leaveRequests, requests);
  add(t.attendanceLogs, attendance);
  await db.batch(stmts as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

  return {
    created: true,
    employees: emps.length,
    leaveRequests: requests.length,
    attendance: attendance.length,
  };
}