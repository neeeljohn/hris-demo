import {
  sqliteTable, text, integer, real, index, uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

// Shared helpers
const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date());

// Companies (every other table belongs to one company)
export const companies = sqliteTable('companies', {
  id: id(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

// Departments and positions
export const departments = sqliteTable('departments', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),
}, (t) => [index('departments_company_idx').on(t.companyId)]);

export const positions = sqliteTable('positions', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  title: text('title').notNull(),
}, (t) => [index('positions_company_idx').on(t.companyId)]);

// Work shifts (minutes from midnight: 480 = 8:00 AM, 1320 = 10:00 PM)
export const shifts = sqliteTable('shifts', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),
  startMinute: integer('start_minute').notNull(),
  endMinute: integer('end_minute').notNull(), // smaller than start = ends the next day
  graceMinutes: integer('grace_minutes').notNull().default(10),
}, (t) => [index('shifts_company_idx').on(t.companyId)]);

// Employees
export const employees = sqliteTable('employees', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeNo: text('employee_no').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  departmentId: text('department_id').references(() => departments.id),
  positionId: text('position_id').references(() => positions.id),
  shiftId: text('shift_id').references(() => shifts.id),
  managerId: text('manager_id').references((): AnySQLiteColumn => employees.id),
  employmentType: text('employment_type', {
    enum: ['regular', 'probationary', 'contractual'],
  }).notNull().default('regular'),
  status: text('status', { enum: ['active', 'on_leave', 'resigned'] })
    .notNull().default('active'),
  hireDate: text('hire_date').notNull(), // "2026-11-26"
  createdAt: createdAt(),
}, (t) => [
  index('employees_company_idx').on(t.companyId),
  uniqueIndex('employees_company_no_idx').on(t.companyId, t.employeeNo),
]);

// Login accounts and sessions
export const users = sqliteTable('users', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').references(() => employees.id),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'finance', 'manager', 'employee'] }).notNull(),
  createdAt: createdAt(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // hashed session token
  userId: text('user_id').notNull().references(() => users.id),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

// Leave
export const leaveTypes = sqliteTable('leave_types', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(), // Vacation, Sick, Emergency...
  defaultDays: real('default_days').notNull().default(0),
});

export const leaveBalances = sqliteTable('leave_balances', {
  id: id(),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  leaveTypeId: text('leave_type_id').notNull().references(() => leaveTypes.id),
  year: integer('year').notNull(),
  allocated: real('allocated').notNull().default(0),
  used: real('used').notNull().default(0),
}, (t) => [uniqueIndex('leave_balances_unique').on(t.employeeId, t.leaveTypeId, t.year)]);

export const leaveRequests = sqliteTable('leave_requests', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  leaveTypeId: text('leave_type_id').notNull().references(() => leaveTypes.id),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  days: real('days').notNull(),
  reason: text('reason'),
  status: text('status', { enum: ['pending', 'approved', 'rejected', 'cancelled'] })
    .notNull().default('pending'),
  approverId: text('approver_id').references(() => users.id),
  decidedAt: integer('decided_at', { mode: 'timestamp' }),
  createdAt: createdAt(),
}, (t) => [
  index('leave_requests_company_status_idx').on(t.companyId, t.status),
  index('leave_requests_employee_idx').on(t.employeeId),
]);

// Attendance
export const attendanceLogs = sqliteTable('attendance_logs', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  workDate: text('work_date').notNull(), // "2026-11-26"
  timeIn: integer('time_in', { mode: 'timestamp' }),
  timeOut: integer('time_out', { mode: 'timestamp' }),
  status: text('status', { enum: ['present', 'late', 'absent', 'on_leave'] }).notNull(),
}, (t) => [
  uniqueIndex('attendance_employee_date_idx').on(t.employeeId, t.workDate),
  index('attendance_company_date_idx').on(t.companyId, t.workDate),
]);

// Documents (201 files stored in R2)
export const documents = sqliteTable('documents', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  name: text('name').notNull(),
  type: text('type').notNull(), // contract, id, certificate...
  r2Key: text('r2_key').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  uploadedAt: createdAt(),
}, (t) => [index('documents_employee_idx').on(t.employeeId)]);

// Failed / demo login counters for rate limiting
export const loginAttempts = sqliteTable('login_attempts', {
  key: text('key').primaryKey(), // e.g. "login:203.0.113.5"
  count: integer('count').notNull(),
  resetAt: integer('reset_at', { mode: 'timestamp' }).notNull(),
});
// Owner analytics (not touched by the demo reset)
export const visits = sqliteTable('visits', {
  id: text('id').primaryKey(), // one browser session
  visitorId: text('visitor_id').notNull(), // same person across visits
  ipMasked: text('ip_masked'),
  country: text('country'),
  city: text('city'),
  region: text('region'),
  device: text('device'),
  browser: text('browser'),
  os: text('os'),
  referrer: text('referrer'),
  landingPath: text('landing_path'),
  roles: text('roles').notNull().default(''), // demo roles tried, e.g. "admin,manager"
  pageViews: integer('page_views').notNull().default(1),
  actions: integer('actions').notNull().default(0),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull(),
}, (t) => [index('visits_started_idx').on(t.startedAt), index('visits_visitor_idx').on(t.visitorId)]);

export const visitEvents = sqliteTable('visit_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  visitId: text('visit_id').notNull(),
  name: text('name').notNull(), // e.g. "demo:admin", "POST /api/leave/:id/decide"
  at: integer('at', { mode: 'timestamp' }).notNull(),
}, (t) => [index('visit_events_at_idx').on(t.at)]);