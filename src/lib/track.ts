const VID = 'acie_vid'; // same person, kept in this browser
const SID = 'acie_sid'; // one visit, ends when the tab closes
const IGNORE = 'acie_ignore';

const safe = <T,>(fn: () => T, fallback: T): T => {
  try { return fn(); } catch { return fallback; }
};
export const isIgnored = () => safe(() => localStorage.getItem(IGNORE) === '1', false);
export const setIgnored = (on: boolean) =>
  safe(() => (on ? localStorage.setItem(IGNORE, '1') : localStorage.removeItem(IGNORE)), undefined);
export const visitId = () => (isIgnored() ? null : safe(() => sessionStorage.getItem(SID), null));

const post = (path: string, body: object) =>
  fetch(`/api/track/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), keepalive: true,
  }).catch(() => {});

let timer: ReturnType<typeof setInterval> | undefined;

// Returns true when a new visit was just created
export function startTracking() {
  if (isIgnored()) return false;
  let created = false;
  let vid = safe(() => localStorage.getItem(VID), null);
  if (!vid) {
    vid = crypto.randomUUID();
    const v = vid;
    safe(() => localStorage.setItem(VID, v), undefined);
  }
  let sid = safe(() => sessionStorage.getItem(SID), null);
  if (!sid) {
    sid = crypto.randomUUID();
    const s = sid;
    safe(() => sessionStorage.setItem(SID, s), undefined);
    post('start', { sessionId: sid, visitorId: vid, path: location.pathname, referrer: document.referrer });
    created = true;
  }
  if (!timer) {
    const s = sid;
    timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !isIgnored()) post('ping', { sessionId: s });
    }, 60_000);
  }
  return created;
}

export function trackPageView() {
  const sid = visitId();
  if (sid) post('ping', { sessionId: sid, pageView: true });
}