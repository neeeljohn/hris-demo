import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb } from './db/client';
import { users } from './db/schema';
import { verifyPassword } from './lib/password';
import { type AppEnv, type Role, startSession, endSession, requireAuth } from './lib/session';
import { seedDemo } from './dev/seed';
import employeeRoutes from './routes/employees';
import leaveRoutes from './routes/leave';
import attendanceRoutes from './routes/attendance';
import documentRoutes from './routes/documents';

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
// Local-only: create (or reset with ?reset=1) the full demo company
app.post('/dev/seed', async (c) => {
  if (c.env.ALLOW_SEED !== 'true') return c.json({ error: 'Not found' }, 404);
  const result = await seedDemo(getDb(c.env), c.env.hris_files, { reset: c.req.query('reset') === '1' });
  return c.json(result);
});

app.route('/employees', employeeRoutes);
app.route('/leave', leaveRoutes);
app.route('/attendance', attendanceRoutes);
app.route('/documents', documentRoutes);
export default app;