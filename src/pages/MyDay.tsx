import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { Card, StatusBadge, fmtHours, fmtTime } from '../components/ui';

type Log = { workDate: string; timeIn: string | null; timeOut: string | null; status: string };
type Me = {
  firstName: string; today: string; onLeave: boolean;
  todayLog: Log | null; week: Log[]; summary: Record<string, number>;
};
type Action = 'clock-in' | 'clock-out' | 'undo-clock-out';

const UNDO_WINDOW = 5 * 60_000;
const timeText = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
const greeting = (ms: number) => {
  const h = Number(new Date(ms).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' }));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });

export default function MyDay() {
  const [me, setMe] = useState<Me | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() =>
    api<Me>('/attendance/me').then(setMe).catch((e: Error) => setError(e.message)), []);

  useEffect(() => {
    load();
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  async function run(action: Action) {
    setBusy(true);
    setError('');
    try {
      await api(`/attendance/${action}`, { method: 'POST' });
      setConfirming(false);
      setNow(Date.now());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (!me) return error
    ? <p role="alert" className="text-sm text-red-700">{error}</p>
    : <p className="text-sm text-muted">Loading…</p>;

  const log = me.todayLog;
  const state = me.onLeave ? 'leave' : !log?.timeIn ? 'out' : !log.timeOut ? 'working' : 'done';
  const canUndo = state === 'done' && !!log?.timeOut && now - Date.parse(log.timeOut) < UNDO_WINDOW;
  const clock = timeText(now);

  const view = {
    out: { badge: 'Not started', big: clock, sub: "You haven't clocked in yet today." },
    working: {
      badge: 'Working', big: clock,
      sub: `Clocked in at ${fmtTime(log?.timeIn ?? null)} · ${log?.status === 'late' ? 'late' : 'on time'}`,
    },
    done: {
      badge: 'Completed', big: fmtHours(log?.timeIn ?? null, log?.timeOut ?? null),
      sub: `${fmtTime(log?.timeIn ?? null)} – ${fmtTime(log?.timeOut ?? null)}`,
    },
    leave: { badge: 'On leave', big: 'Day off', sub: "You're on approved leave today. Enjoy!" },
  }[state];

  const bigBtn = 'h-13 rounded-xl text-base font-semibold disabled:opacity-70';
  const summary: [string, number][] = [
    ['Present', me.summary.present], ['Late', me.summary.late],
    ['Absent', me.summary.absent], ['On leave', me.summary.on_leave],
  ];

  return (
    <div className="space-y-5">
      <div>
        <div className="text-sm text-muted">
          {new Date(`${me.today}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{greeting(now)}, {me.firstName}</h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="flex flex-col gap-4 rounded-2xl bg-brand p-7 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm text-violet-100">Shift 8:00 AM – 5:00 PM</span>
            <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-semibold">{view.badge}</span>
          </div>
          <div className="font-display text-5xl font-semibold tracking-tight tabular-nums">{view.big}</div>
          <div className="text-sm text-violet-100">{view.sub}</div>
          {error && <p role="alert" className="rounded-lg bg-white/15 px-3 py-2 text-sm">{error}</p>}

          {state === 'out' && (
            <button disabled={busy} onClick={() => run('clock-in')} className={`${bigBtn} bg-white text-violet-text`}>
              {busy ? 'Saving…' : 'Clock in'}
            </button>
          )}

          {state === 'working' && !confirming && (
            <button onClick={() => setConfirming(true)}
                className={`${bigBtn} border-2 border-white/70 text-white hover:bg-white/10`}>
                    Clock out
            </button>
          )}

          {state === 'working' && confirming && (
            <div className="space-y-3 rounded-xl bg-white/15 p-4">
              <p className="text-sm">Clock out now at {clock}? You can undo within 5 minutes.</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setConfirming(false)}
                  className="h-11 rounded-xl border border-white/40 text-sm font-semibold">
                  Keep working
                </button>
                <button disabled={busy} onClick={() => run('clock-out')}
                   className="h-11 rounded-xl bg-red-50 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-70">
                  {busy ? 'Saving…' : 'Yes, clock out'}
                </button>
              </div>
            </div>
          )}

          {state === 'done' && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-violet-100">Done for today. Great work!</span>
              {canUndo && (
                <button disabled={busy} onClick={() => run('undo-clock-out')}
                  className="rounded-lg bg-white/20 px-3 py-2 text-sm font-semibold hover:bg-white/30">
                  Undo clock out
                </button>
              )}
            </div>
          )}
        </section>

        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">This month</h2>
            <Link to="/leave" className="text-sm text-violet-text hover:underline">File leave</Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {summary.map(([label, n]) => (
              <div key={label} className="rounded-xl bg-paper p-4">
                <div className="text-sm text-muted">{label}</div>
                <div className="font-display text-3xl font-semibold">{n}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="overflow-x-auto p-6">
        <h2 className="mb-3 font-semibold">This week</h2>
        <table className="w-full min-w-120 text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2 font-medium">Day</th><th className="font-medium">Time in</th>
              <th className="font-medium">Time out</th><th className="font-medium">Hours</th>
              <th className="font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {me.week.map((l) => (
              <tr key={l.workDate} className="border-t border-line tabular-nums">
                <td className="py-3 font-medium">{dayLabel(l.workDate)}</td>
                <td>{fmtTime(l.timeIn)}</td>
                <td>{fmtTime(l.timeOut)}</td>
                <td>{fmtHours(l.timeIn, l.timeOut)}</td>
                <td><StatusBadge status={l.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {me.week.length === 0 && <p className="py-4 text-sm text-muted">No records this week yet.</p>}
      </Card>
    </div>
  );
}