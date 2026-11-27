import { eq } from 'drizzle-orm';
import type { getDb } from '../db/client';
import { loginAttempts } from '../db/schema';

type DB = ReturnType<typeof getDb>;

// Returns minutes to wait if the limit is reached, otherwise 0
export async function limitWait(db: DB, key: string, max: number) {
  const row = await db.select().from(loginAttempts).where(eq(loginAttempts.key, key)).get();
  if (row && row.resetAt.getTime() > Date.now() && row.count >= max) {
    return Math.ceil((row.resetAt.getTime() - Date.now()) / 60_000);
  }
  return 0;
}

// Count one attempt inside a time window
export async function countAttempt(db: DB, key: string, windowMinutes: number) {
  const now = Date.now();
  const row = await db.select().from(loginAttempts).where(eq(loginAttempts.key, key)).get();
  if (!row || row.resetAt.getTime() <= now) {
    const resetAt = new Date(now + windowMinutes * 60_000);
    await db.insert(loginAttempts).values({ key, count: 1, resetAt })
      .onConflictDoUpdate({ target: loginAttempts.key, set: { count: 1, resetAt } });
  } else {
    await db.update(loginAttempts).set({ count: row.count + 1 }).where(eq(loginAttempts.key, key));
  }
}

export const clearAttempts = (db: DB, key: string) =>
  db.delete(loginAttempts).where(eq(loginAttempts.key, key));