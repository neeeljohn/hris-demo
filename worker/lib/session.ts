import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { sessions, users } from '../db/schema';
import { toHex } from './password';

export type Role = 'admin' | 'finance' | 'manager' | 'employee';
export type SessionUser = {
  id: string; email: string; role: Role; companyId: string; employeeId: string | null;
};
export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };

const COOKIE = 'hris_session';
const MAX_AGE_DAYS = 7;

const sha256Hex = async (text: string) =>
  toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

export async function startSession(c: Context<AppEnv>, userId: string) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  await getDb(c.env).insert(sessions).values({
    id: await sha256Hex(token), // only the hash is stored
    userId,
    expiresAt: new Date(Date.now() + MAX_AGE_DAYS * 86_400_000),
  });
  setCookie(c, COOKIE, token, {
    httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: MAX_AGE_DAYS * 86_400,
  });
}

export async function endSession(c: Context<AppEnv>) {
  const token = getCookie(c, COOKIE);
  if (token) {
    await getDb(c.env).delete(sessions).where(eq(sessions.id, await sha256Hex(token)));
  }
  deleteCookie(c, COOKIE, { path: '/' });
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) return c.json({ error: 'Please sign in.' }, 401);

  const db = getDb(c.env);
  const id = await sha256Hex(token);
  const row = await db
    .select({
      expiresAt: sessions.expiresAt, id: users.id, email: users.email,
      role: users.role, companyId: users.companyId, employeeId: users.employeeId,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .get();

  if (!row || row.expiresAt.getTime() < Date.now()) {
    if (row) await db.delete(sessions).where(eq(sessions.id, id));
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ error: 'Your session expired. Please sign in again.' }, 401);
  }

  c.set('user', {
    id: row.id, email: row.email, role: row.role,
    companyId: row.companyId, employeeId: row.employeeId,
  });
  await next();
};

export const requireRole = (...roles: Role[]): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    if (!roles.includes(c.get('user').role)) {
      return c.json({ error: "You don't have access to this." }, 403);
    }
    await next();
  };