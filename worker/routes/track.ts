import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { visitEvents, visits } from '../db/schema';
import type { AppEnv } from '../lib/session';
import { countAttempt, limitWait } from '../lib/rateLimit';

type DB = ReturnType<typeof getDb>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse/i;

// 112.198.45.10 -> 112.198.45.xxx
const maskIp = (ip: string) =>
  ip.includes('.') ? `${ip.split('.').slice(0, 3).join('.')}.xxx`
    : ip.includes(':') ? `${ip.split(':').slice(0, 3).join(':')}:xxxx` : ip;

function parseUa(ua: string) {
  const device = /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'Phone' : 'Desktop';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung'
    : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  return { device, browser, os };
}

// Save one action for a visit (also used by other routes)
export async function recordEvent(db: DB, visitId: string | undefined, name: string, role?: string) {
  if (!visitId || !UUID.test(visitId)) return;
  const v = await db.select({ roles: visits.roles }).from(visits).where(eq(visits.id, visitId)).get();
  if (!v) return;
  const roles = role && !v.roles.split(',').includes(role) ? (v.roles ? `${v.roles},${role}` : role) : v.roles;
  await db.batch([
    db.insert(visitEvents).values({ visitId, name: name.slice(0, 80), at: new Date() }),
    db.update(visits).set({ actions: sql`${visits.actions} + 1`, roles }).where(eq(visits.id, visitId)),
  ]);
}

const app = new Hono<AppEnv>();

app.post('/start', async (c) => {
  const ua = c.req.header('User-Agent') ?? '';
  if (BOT.test(ua)) return c.json({ ok: true });
  const b = await c.req.json<{ sessionId?: string; visitorId?: string; path?: string; referrer?: string }>()
    .catch(() => ({} as { sessionId?: string; visitorId?: string; path?: string; referrer?: string }));
  if (!b.sessionId || !UUID.test(b.sessionId) || !b.visitorId || !UUID.test(b.visitorId)) {
    return c.json({ ok: false }, 400);
  }

  const db = getDb(c.env);
  const ip = c.req.header('CF-Connecting-IP') ?? 'local';
  const key = `track:${ip}`;
  if (await limitWait(db, key, 60)) return c.json({ ok: false }, 429);
  await countAttempt(db, key, 15);

  const cf = c.req.raw.cf as { country?: string; city?: string; region?: string } | undefined;
  let source: string | null = null;
  try {
    if (b.referrer) {
      const host = new URL(b.referrer).hostname.replace(/^www\./, '');
      if (host !== new URL(c.req.url).hostname) source = host;
    }
  } catch { /* ignore bad referrers */ }

  const now = new Date();
  await db.insert(visits).values({
    id: b.sessionId, visitorId: b.visitorId, ipMasked: maskIp(ip),
    country: cf?.country ?? null, city: cf?.city ?? null, region: cf?.region ?? null,
    ...parseUa(ua), referrer: source, landingPath: (b.path ?? '/').slice(0, 100),
    startedAt: now, lastSeenAt: now,
  }).onConflictDoNothing();
  return c.json({ ok: true });
});

// "Still here" signal every minute, and +1 page view on navigation
app.post('/ping', async (c) => {
  const b = await c.req.json<{ sessionId?: string; pageView?: boolean }>()
    .catch(() => ({} as { sessionId?: string; pageView?: boolean }));
  if (!b.sessionId || !UUID.test(b.sessionId)) return c.json({ ok: false }, 400);
  await getDb(c.env).update(visits).set({
    lastSeenAt: new Date(),
    ...(b.pageView ? { pageViews: sql`${visits.pageViews} + 1` } : {}),
  }).where(eq(visits.id, b.sessionId));
  return c.json({ ok: true });
});

export default app;