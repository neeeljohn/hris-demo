import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb } from './db/client';
import { companies, departments, employees, users } from './db/schema';
import { hashPassword, verifyPassword } from './lib/password';
import { type AppEnv, type Role, startSession, endSession, requireAuth } from './lib/session';

const app = new Hono<AppEnv>().basePath('/api');
const ROLES: Role[] = ['admin', 'finance', 'manager', 'employee'];

const publicUser = (u: { id: string; email: string; role: Role; companyId: string; employeeId: string | null }) =>
  ({ id: u.id, email: u.email, role: u.role, companyId: u.companyId, employeeId: u.employeeId });

// Sign in with email + password
app.post('/auth/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => ({} as { email?: string; password?: string }));
  const email = body.email?.trim().toLowerCase();
  if (!email || !body.password) return c.json({ error: 'Enter your email and password.' }, 400);

  const user = await getDb(c.env).select().from(users).where(eq(users.email, email)).get();
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    return c.json({ error: 'Wrong email or password.' }, 401);
  }
  await startSession(c, user.id);
  return c.json({ user: publicUser(user) });
});

// One-click demo login (only when DEMO_MODE is on)
app.post('/auth/demo', async (c) => {
  if (c.env.DEMO_MODE !== 'true') return c.json({ error: 'Not found' }, 404);
  const { role } = await c.req.json<{ role?: Role }>().catch(() => ({} as { role?: Role }));
  if (!role || !ROLES.includes(role)) return c.json({ error: 'Choose a demo role.' }, 400);

  const user = await getDb(c.env).select().from(users).where(eq(users.email, `${role}@demo.ph`)).get();
  if (!user) return c.json({ error: 'Demo data is not set up yet.' }, 404);
  await startSession(c, user.id);
  return c.json({ user: publicUser(user) });
});

app.post('/auth/logout', async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

// Who am I?
app.get('/auth/me', requireAuth, (c) => c.json({ user: c.get('user') }));

// Local-only: create the demo company and 4 demo accounts
app.post('/dev/seed', async (c) => {
  if (c.env.ALLOW_SEED !== 'true') return c.json({ error: 'Not found' }, 404);
  const db = getDb(c.env);
  if (await db.select().from(users).where(eq(users.email, 'admin@demo.ph')).get()) {
    return c.json({ ok: true, message: 'Already set up' });
  }

  const [company] = await db.insert(companies).values({ name: 'Sunrise Trading (Demo)' }).returning();
  const depts = await db.insert(departments)
    .values(['Operations', 'Sales', 'IT', 'Finance', 'HR'].map((name) => ({ companyId: company.id, name })))
    .returning();
  const deptId = (name: string) => depts.find((d) => d.name === name)!.id;

  const people = [
    { role: 'admin', first: 'Maria', last: 'Santos', dept: 'HR' },
    { role: 'finance', first: 'Liza', last: 'Bautista', dept: 'Finance' },
    { role: 'manager', first: 'Paolo', last: 'Ramos', dept: 'Sales' },
    { role: 'employee', first: 'Juan', last: 'Dela Cruz', dept: 'Operations' },
  ] as const;

  for (const [i, p] of people.entries()) {
    const [emp] = await db.insert(employees).values({
      companyId: company.id,
      employeeNo: `EMP-${String(i + 1).padStart(3, '0')}`,
      firstName: p.first, lastName: p.last,
      email: `${p.role}@demo.ph`,
      departmentId: deptId(p.dept),
      hireDate: '2024-01-15',
    }).returning();
    await db.insert(users).values({
      companyId: company.id, employeeId: emp.id,
      email: `${p.role}@demo.ph`,
      passwordHash: await hashPassword('demo1234'),
      role: p.role,
    });
  }
  return c.json({ ok: true, message: 'Demo accounts created' });
});

export default app;