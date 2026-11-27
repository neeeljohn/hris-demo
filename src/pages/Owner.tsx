import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { ROLE_LABEL, type Role } from '../lib/auth';
import { isIgnored, setIgnored } from '../lib/track';
import { Card, btnPrimary, btnSecondary, inputCls } from '../components/ui';

type Row = { name: string | null; n: number };
type Visit = {
  id: string; visitorId: string; ipMasked: string | null; country: string | null; city: string | null;
  device: string | null; browser: string | null; os: string | null; referrer: string | null;
  roles: string; pageViews: number; actions: number; startedAt: string; seconds: number;
};
type Summary = {
  days: number;
  totals: { visitors: number; sessions: number; avgSeconds: number; pageViews: number; today: number; liveNow: number };
  countries: Row[]; sources: Row[]; devices: Row[];
  daily: { day: string; n: number }[];
  events: { name: string; n: number }[];
  recent: Visit[];
};

const KEY = 'acie_owner_key';
const EVENT_LABEL: Record<string, string> = {
  'POST /api/auth/login': 'Password sign-in',
  'POST /api/auth/logout': 'Logged out',
  'POST /api/leave': 'Filed leave',
  'POST /api/leave/:id/decide': 'Approved or rejected leave',
  'POST /api/leave/:id/cancel': 'Cancelled leave',
  'POST /api/attendance/clock-in': 'Clocked in',
  'POST /api/attendance/clock-out': 'Clocked out',
  'POST /api/attendance/undo-clock-out': 'Undid clock-out',
  'POST /api/employees': 'Added employee',
  'PUT /api/employees/:id': 'Edited employee',
  'GET /api/attendance/export': 'Exported attendance',
};
const eventLabel = (name: string) =>
  name.startsWith('demo:') ? `Tried ${ROLE_LABEL[name.slice(5) as Role] ?? name.slice(5)}` : EVENT_LABEL[name] ?? name;
const dur = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });

function List({ title, rows }: { title: string; rows: { label: string; n: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <Card className="p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.label} className="text-sm">
            <div className="flex justify-between"><span className="truncate text-body">{r.label}</span><span className="font-semibold">{r.n}</span></div>
            <div className="mt-1 h-1.5 rounded-full bg-violet-tint"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${(r.n / max) * 100}%` }} /></div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted">No data yet.</p>}
      </div>
    </Card>
  );
}

export default function Owner() {
  const [key, setKey] = useState(() => sessionStorage.getItem(KEY) ?? '');
  const [input, setInput] = useState('');
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [ignored, setIgnoredState] = useState(isIgnored());

  const load = useCallback(() => {
    if (!key) return;
    api<Summary>(`/owner/summary?days=${days}`, { headers: { 'X-Owner-Key': key } })
      .then((d) => { setData(d); setError(''); })
      .catch((e: Error) => {
        setError(e.message);
        if (e.message === 'Wrong owner key.') { sessionStorage.removeItem(KEY); setKey(''); }
      });
  }, [key, days]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  function unlock(e: FormEvent) {
    e.preventDefault();
    sessionStorage.setItem(KEY, input.trim());
    setKey(input.trim());
    setInput('');
  }

  if (!key) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <Card className="w-full max-w-sm space-y-4 p-6">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="" className="size-8" />
            <h1 className="font-display text-xl font-bold">ACIE owner</h1>
          </div>
          <form onSubmit={unlock} className="space-y-3">
            <label className="block text-sm font-medium">Owner key
              <input type="password" value={input} onChange={(e) => setInput(e.target.value)} className={`${inputCls} mt-1.5`} />
            </label>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <button className={`${btnPrimary} w-full`}>Open</button>
          </form>
        </Card>
      </div>
    );
  }

  const t = data?.totals;
  const maxDay = Math.max(1, ...(data?.daily.map((d) => d.n) ?? [1]));
  const cards: [string, string | number][] = t ? [
    ['Visitors', t.visitors], ['Today', t.today], ['Live now', t.liveNow],
    ['Sessions', t.sessions], ['Avg. time', dur(t.avgSeconds)], ['Page views', t.pageViews],
  ] : [];

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="" className="size-9" />
          <div>
            <h1 className="font-display text-2xl font-semibold">Who's using ACIE</h1>
            <p className="text-sm text-muted">Masked IPs · auto-deleted after 90 days · refreshes every minute</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[1, 7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`h-9 rounded-full border px-3.5 text-sm font-medium ${days === d ? 'border-violet-300 bg-violet-tint text-violet-text' : 'border-field bg-white text-body'}`}>
              {d === 1 ? '24h' : `${d} days`}
            </button>
          ))}
          <button onClick={load} aria-label="Refresh" className={`${btnSecondary} h-9 w-9 px-0`}><RefreshCw size={16} /></button>
          <button onClick={() => { sessionStorage.removeItem(KEY); setKey(''); setData(null); }} className={`${btnSecondary} h-9`}>Lock</button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-body">
        <input type="checkbox" checked={ignored} onChange={(e) => { setIgnored(e.target.checked); setIgnoredState(e.target.checked); }} />
        Don't count my own visits on this browser
      </label>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="text-sm text-muted">Loading…</p>}

      {data && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
            {cards.map(([label, value]) => (
              <Card key={label} className="p-4">
                <div className="text-sm text-muted">{label}</div>
                <div className="mt-1 font-display text-2xl font-semibold">{value}</div>
              </Card>
            ))}
          </div>

          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Visitors per day</h2>
            <div className="flex h-32 items-end gap-1.5">
              {data.daily.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.n}`}>
                  <span className="text-xs font-semibold">{d.n}</span>
                  <div className="w-full rounded-t bg-brand" style={{ height: `${(d.n / maxDay) * 90}px` }} />
                  <span className="text-[11px] text-muted">{d.day.slice(5)}</span>
                </div>
              ))}
              {data.daily.length === 0 && <p className="text-sm text-muted">No visits yet.</p>}
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <List title="Countries" rows={data.countries.map((r) => ({ label: r.name ?? 'Unknown', n: r.n }))} />
            <List title="Sources" rows={data.sources.map((r) => ({ label: r.name ?? 'Direct / typed link', n: r.n }))} />
            <List title="Devices" rows={data.devices.map((r) => ({ label: r.name ?? 'Unknown', n: r.n }))} />
            <List title="What they did" rows={data.events.map((r) => ({ label: eventLabel(r.name), n: r.n }))} />
          </div>

          <Card className="overflow-x-auto">
            <table className="w-full min-w-240 text-sm">
              <thead>
                <tr className="bg-paper text-left text-xs text-muted">
                  <th className="px-4 py-3 font-medium">When</th><th className="font-medium">Where</th>
                  <th className="font-medium">IP</th><th className="font-medium">Device</th>
                  <th className="font-medium">Source</th><th className="font-medium">Time on app</th>
                  <th className="font-medium">Pages</th><th className="font-medium">Roles tried</th>
                  <th className="font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((v) => (
                  <tr key={v.id} className="border-t border-line">
                    <td className="px-4 py-2.5 whitespace-nowrap">{when(v.startedAt)}</td>
                    <td>{[v.city, v.country].filter(Boolean).join(', ') || '—'}</td>
                    <td className="tabular-nums text-muted">{v.ipMasked ?? '—'}</td>
                    <td>{v.device} · {v.browser} · {v.os}</td>
                    <td>{v.referrer ?? 'Direct'}</td>
                    <td className="tabular-nums">{dur(v.seconds)}</td>
                    <td className="tabular-nums">{v.pageViews}</td>
                    <td>{v.roles ? v.roles.split(',').map((r) => ROLE_LABEL[r as Role] ?? r).join(', ') : '—'}</td>
                    <td className="tabular-nums">{v.actions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.recent.length === 0 && <p className="p-6 text-center text-sm text-muted">No visits yet.</p>}
          </Card>
        </>
      )}
    </div>
  );
}