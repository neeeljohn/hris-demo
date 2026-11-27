import { Hono } from 'hono';
import { desc, gte, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { visitEvents, visits } from '../db/schema';
import type { AppEnv } from '../lib/session';
import { countAttempt, limitWait } from '../lib/rateLimit';

const app = new Hono<AppEnv>();

// Only you: secret owner key, max 10 wrong tries per 15 minutes
app.use('*', async (c, next) => {
  const db = getDb(c.env);
  const key = `owner:${c.req.header('CF-Connecting-IP') ?? 'local'}`;
  const wait = await limitWait(db, key, 10);
  if (wait) return c.json({ error: `Too many tries. Wait ${wait} min.` }, 429);
  const secret = c.env.OWNER_KEY?.trim() ?? '';
  const given = c.req.header('X-Owner-Key')?.trim() ?? '';
  if (secret.length < 32 || given !== secret) {
    await countAttempt(db, key, 15);
    return c.json({ error: 'Wrong owner key.' }, 401);
  }
  await next();
});

app.get('/summary', async (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query('days')) || 7));
  const db = getDb(c.env);
  const now = Date.now();
  const since = new Date(now - days * 86_400_000);
  const m = new Date(now + 8 * 3_600_000);
  const todayStart = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate()) - 8 * 3_600_000);
  const people = sql<number>`count(distinct ${visits.visitorId})`;
  const top = (col: typeof visits.country | typeof visits.referrer | typeof visits.device) =>
    db.select({ name: col, n: people }).from(visits).where(gte(visits.startedAt, since))
      .groupBy(col).orderBy(sql`2 desc`).limit(10);

  const [totals, today, live, countries, sources, devices, daily, events, recent] = await Promise.all([
    db.select({
      visitors: people,
      sessions: sql<number>`count(*)`,
      avgSeconds: sql<number>`coalesce(avg(${visits.lastSeenAt} - ${visits.startedAt}), 0)`,
      pageViews: sql<number>`coalesce(sum(${visits.pageViews}), 0)`,
    }).from(visits).where(gte(visits.startedAt, since)).get(),
    db.select({ n: people }).from(visits).where(gte(visits.startedAt, todayStart)).get(),
    db.select({ n: sql<number>`count(*)` }).from(visits).where(gte(visits.lastSeenAt, new Date(now - 2 * 60_000))).get(),
    top(visits.country),
    top(visits.referrer),
    top(visits.device),
    db.select({ day: sql<string>`date(${visits.startedAt}, 'unixepoch', '+8 hours')`, n: people })
      .from(visits).where(gte(visits.startedAt, since)).groupBy(sql`1`).orderBy(sql`1`),
    db.select({ name: visitEvents.name, n: sql<number>`count(*)` }).from(visitEvents)
      .where(gte(visitEvents.at, since)).groupBy(visitEvents.name).orderBy(sql`2 desc`).limit(20),
    db.select().from(visits).where(gte(visits.startedAt, since)).orderBy(desc(visits.startedAt)).limit(50),
  ]);

  return c.json({
    days,
    totals: {
      visitors: totals?.visitors ?? 0, sessions: totals?.sessions ?? 0,
      avgSeconds: Math.round(totals?.avgSeconds ?? 0), pageViews: totals?.pageViews ?? 0,
      today: today?.n ?? 0, liveNow: live?.n ?? 0,
    },
    countries, sources, devices, daily, events,
    recent: recent.map((v) => ({
      ...v, seconds: Math.round((v.lastSeenAt.getTime() - v.startedAt.getTime()) / 1000),
    })),
  });
});

export default app;