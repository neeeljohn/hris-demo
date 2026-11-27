import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { eq } from 'drizzle-orm';
import { getDb } from './db/client';
import { users } from './db/schema';
import { verifyPassword } from './lib/password';
import { clearAttempts, countAttempt, limitWait } from './lib/rateLimit';
import { type AppEnv, type Role, startSession, endSession, requireAuth } from './lib/session';
import { seedDemo } from './dev/seed';
import employeeRoutes from './routes/employees';
import leaveRoutes from './routes/leave';
import attendanceRoutes from './routes/attendance';
import documentRoutes from './routes/documents';
import dashboardRoutes from './routes/dashboard';

const app = new Hono<AppEnv>().basePath('/api');
app.use('*', secureHeaders());
app.use('*', csrf());

const ROLES: Role[] = ['admin', 'finance', 'manager', 'employee'];
const ipOf = (c: { req: { header: (n: string) => string | undefined } }) =>
  c.req.header('CF-Connecting-IP') ?? 'local';

const publicUser = (u: { id: string; email: string; role: Role; companyId: string; employeeId: string | null }) =>
  ({ id: u.id, email: u.email, role: u.role, companyId: u.companyId, employeeId: u.employeeId });

// App settings the frontend needs
app.get('/config', (c) => c.json({ demo: c.env.DEMO_MODE === 'true' }));

// Sign in with email + password (max 10 failed tries per 15 minutes per IP)
app.post('/auth/login', async (c) => {
  const db = getDb(c.env);
  const key = `login:${ipOf(c)}`;
  const wait = await limitWait(db, key, 10);
  if (wait) return c.json({ error: `Too many sign-in attempts. Try again in ${wait} min.` }, 429);

  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => ({} as { email?: string; password?: string }));
  const email = body.email?.trim().toLowerCase();
  if (!email || !body.password) return c.json({ error: 'Enter your email and password.' }, 400);

  const user = await db.select().from(users).where(eq(users.email, email)).get();
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    await countAttempt(db, key, 15);
    return c.json({ error: 'Wrong email or password.' }, 401);
  }
  await clearAttempts(db, key);
  await startSession(c, user.id);
  return c.json({ user: publicUser(user) });
});

// One-click demo login (max 30 per 15 minutes per IP)
app.post('/auth/demo', async (c) => {
  if (c.env.DEMO_MODE !== 'true') return c.json({ error: 'Not found' }, 404);
  const db = getDb(c.env);
  const key = `demo:${ipOf(c)}`;
  const wait = await limitWait(db, key, 30);
  if (wait) return c.json({ error: `Too many demo logins. Try again in ${wait} min.` }, 429);

  const { role } = await c.req.json<{ role?: Role }>().catch(() => ({} as { role?: Role }));
  if (!role || !ROLES.includes(role)) return c.json({ error: 'Choose a demo role.' }, 400);
  const user = await db.select().from(users).where(eq(users.email, `${role}@demo.ph`)).get();
  if (!user) return c.json({ error: 'Demo data is not set up yet.' }, 404);

  await countAttempt(db, key, 15);
  await startSession(c, user.id);
  return c.json({ user: publicUser(user) });
});

app.post('/auth/logout', async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

app.get('/auth/me', requireAuth, (c) => c.json({ user: c.get('user') }));

// Create or reset the demo company.
// Works locally (ALLOW_SEED) or on the live site with the secret SEED_TOKEN header.
app.post('/dev/seed', async (c) => {
  const token = c.req.header('X-Seed-Token');
  const allowed = c.env.ALLOW_SEED === 'true'
    || (!!c.env.SEED_TOKEN && c.env.SEED_TOKEN !== 'local-only' && token === c.env.SEED_TOKEN);
  if (!allowed) return c.json({ error: 'Not found' }, 404);
  const result = await seedDemo(getDb(c.env), c.env.hris_files, { reset: c.req.query('reset') === '1' });
  return c.json(result);
});

app.route('/employees', employeeRoutes);
app.route('/leave', leaveRoutes);
app.route('/attendance', attendanceRoutes);
app.route('/documents', documentRoutes);
app.route('/dashboard', dashboardRoutes);

export default {
  fetch: app.fetch,
  // Nightly reset of the demo data (see "triggers" in wrangler.jsonc)
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (env.DEMO_MODE !== 'true') return;
    ctx.waitUntil(seedDemo(getDb(env), env.hris_files, { reset: true }).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;