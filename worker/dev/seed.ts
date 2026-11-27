import { getTableColumns } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { getDb } from '../db/client';
import * as t from '../db/schema';
import { tinyPdf } from '../lib/pdf';

type DB = ReturnType<typeof getDb>;
type Dept = 'Operations' | 'Sales' | 'IT' | 'Finance' | 'HR';
type EmpType = 'regular' | 'probationary' | 'contractual';
type LeaveName = 'Vacation' | 'Sick' | 'Emergency';
type Status = 'pending' | 'approved' | 'rejected';
type ShiftName = 'Day' | 'Mid' | 'Night';

const DEPTS: Dept[] = ['Operations', 'Sales', 'IT', 'Finance', 'HR'];

// [name, start minute, end minute]
const SHIFTS: [ShiftName, number, number][] = [['Day', 480, 1020], ['Mid', 840, 1380], ['Night', 1320, 420]];
const SHIFT_OF: Record<string, ShiftName> = {
  'Kim Torres': 'Mid', 'Jun Reyes': 'Mid', 'Christine Flores': 'Mid',
  'Leo Santiago': 'Night', 'Joy Fernandez': 'Night', 'Rachel Lim': 'Night',
};

// Monthly basic salary by position (PHP)
const SALARY: Record<string, number> = {
  'HR Manager': 55000, 'Operations Head': 60000, 'Sales Manager': 55000, 'Finance Manager': 58000,
  'IT Lead': 60000, 'Warehouse Supervisor': 28000, 'Warehouse Staff': 16000, 'Delivery Driver': 17000,
  'Inventory Clerk': 18000, 'Operations Assistant': 20000, 'Sales Associate': 20000,
  'Account Executive': 30000, 'Web Developer': 45000, 'IT Support': 22000, 'Accountant': 32000,
  'Payroll Officer': 28000, 'Accounting Clerk': 19000, 'HR Officer': 26000,
  'Recruitment Specialist': 27000, 'HR Assistant': 18000,
};

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

// Precomputed hash of the demo password "demo1234" (it's public anyway)
const DEMO_HASH = 'pbkdf2$100000$9b6e3662bca20a12a8e7ade969c10311$7f914cd546881b9a08637de49ddb8f86a94dd466714bd9eea9e2de18e628b5f3';

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
// [employee, type, document name]
const DOCS: [string, string, string][] = [
  ['Juan Dela Cruz', 'contract', 'Employment contract'],
  ['Juan Dela Cruz', 'government_id', 'Government IDs (SSS, PhilHealth, Pag-IBIG, TIN)'],
  ['Juan Dela Cruz', 'certificate', 'NBI clearance'],
  ['Maria Santos', 'contract', 'Employment contract'],
  ['Paolo Ramos', 'contract', 'Employment contract'],
  ['Liza Bautista', 'contract', 'Employment contract'],
  ['Grace Villanueva', 'medical', 'Medical certificate'],
  ['Carlo Mendoza', 'certificate', 'AWS Cloud Practitioner certificate'],
  ['Mark Garcia', 'contract', 'Probationary contract'],
];

// Remove every file in the demo bucket (used on reset)
async function clearBucket(bucket: R2Bucket) {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ cursor });
    if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

const DAY = 86_400_000;
const MNL = 8 * 3_600_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isWeekday = (ms: number) => ![0, 6].includes(new Date(ms).getUTCDay());
const at = (dayMs: number, minutes: number) => new Date(dayMs + minutes * 60_000 - MNL);
const workdays = (from: number, to: number) => {
  let n = 0;
  for (let d = from; d <= to; d += DAY) if (isWeekday(d)) n++;
  return n;
};
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

export async function seedDemo(db: DB, bucket: R2Bucket, opts: { reset?: boolean } = {}) {
  if (opts.reset) {
    await clearBucket(bucket);
    await db.batch([
      db.delete(t.payslips), db.delete(t.payRuns),
      db.delete(t.loginAttempts),
      db.delete(t.sessions), db.delete(t.documents), db.delete(t.attendanceLogs),
      db.delete(t.leaveRequests), db.delete(t.leaveBalances), db.delete(t.leaveTypes),
      db.delete(t.users), db.delete(t.employees), db.delete(t.shifts), db.delete(t.positions),
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
  const companyId = uuid();

  const deptId = Object.fromEntries(DEPTS.map((d) => [d, uuid()])) as Record<Dept, string>;
  const titles = [...new Set(PEOPLE.map((p) => p[3]))];
  const positionId = Object.fromEntries(titles.map((title) => [title, uuid()]));
  const shiftRows = SHIFTS.map(([name, startMinute, endMinute]) => ({
    id: uuid(), companyId, name, startMinute, endMinute, graceMinutes: 10,
  }));
  const shiftByName = Object.fromEntries(shiftRows.map((s) => [s.name, s])) as Record<ShiftName, (typeof shiftRows)[number]>;

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
    shiftId: shiftByName[SHIFT_OF[`${first} ${last}`] ?? 'Day'].id, monthlyRate: SALARY[title] ?? 20000,
    employmentType: type,
    status: 'active' as 'active' | 'on_leave',
    hireDate: hire,
  }));
  const byName = new Map(emps.map((e) => [`${e.firstName} ${e.lastName}`, e]));
  const deptOf = new Map(PEOPLE.map((p, i) => [ids[i], p[2]]));
  const shiftOf = new Map(emps.map((e) => [e.id, shiftRows.find((s) => s.id === e.shiftId)!]));

  const hash = DEMO_HASH;
  const users = DEMO_USERS.map(([role, name]) => ({
    id: uuid(), companyId, employeeId: byName.get(name)!.id,
    email: `${role}@demo.ph`, passwordHash: hash, role,
  }));
  const userId = (role: string) => users.find((u) => u.role === role)!.id;
  const demoIds = new Set(users.map((u) => u.employeeId));

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

  // Attendance for ~30 days, following each person's shift
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
      const shift = shiftOf.get(emp.id)!;
      const start = shift.startMinute;
      const length = shift.endMinute > start ? shift.endMinute - start : shift.endMinute + 1440 - start;
      const roll = r();
      const late = roll < 0.18;
      const inMin = late ? start + 11 + Math.floor(r() * 30) : start - 25 + Math.floor(r() * 25);
      const outMin = start + length + Math.floor(r() * 40);
      const timeIn = at(day, inMin);
      const timeOut = at(day, outMin);

      if (off === 0 && demoIds.has(emp.id)) continue; // demo users clock in themselves
      if (timeIn.getTime() > now) continue; // shift hasn't started yet
      if (roll > 0.96 && off !== 0) {
        attendance.push({ id: uuid(), companyId, employeeId: emp.id, workDate: date, status: 'absent' });
        continue;
      }
      attendance.push({
        id: uuid(), companyId, employeeId: emp.id, workDate: date, timeIn,
        timeOut: timeOut.getTime() > now ? null : timeOut, // still working
        status: late ? 'late' : 'present',
      });
    }
  }

    // Sample PDF files for the demo
    const docRows = DOCS.map(([name, type, title]) => {
    const emp = byName.get(name)!;
    const id = uuid();
    const pdf = tinyPdf(title, [
      `Employee: ${emp.firstName} ${emp.lastName}`,
      `Employee no.: ${emp.employeeNo}`,
      'Company: Sunrise Trading (Demo)',
      'This is a sample document for the ACIE HRIS demo.',
      'It is not a real record.',
    ]);
    return { id, companyId, employeeId: emp.id, name: title, type, r2Key: `${companyId}/${emp.id}/${id}.pdf`, sizeBytes: pdf.length, pdf };
  });
  await Promise.all(docRows.map((d) =>
    bucket.put(d.r2Key, d.pdf, { httpMetadata: { contentType: 'application/pdf' } })));

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
  add(t.shifts, shiftRows);
  add(t.employees, emps);
  add(t.users, users);
  add(t.leaveTypes, LEAVE_TYPES.map(([name, days]) => ({ id: typeId[name], companyId, name, defaultDays: days })));
  add(t.leaveBalances, balances);
  add(t.leaveRequests, requests);
  add(t.attendanceLogs, attendance);
  add(t.documents, docRows.map(({ pdf: _pdf, ...row }) => row));
  await db.batch(stmts as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

  return { created: true, employees: emps.length, leaveRequests: requests.length, attendance: attendance.length };
}