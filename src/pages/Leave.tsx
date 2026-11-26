import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Avatar, Card, StatusBadge, btnPrimary, btnSecondary, fmtDate, inputCls } from '../components/ui';

const DAY = 86_400_000;
function workdays(start: string, end: string) {
  let n = 0;
  for (let d = Date.parse(`${start}T00:00:00Z`); d <= Date.parse(`${end}T00:00:00Z`); d += DAY) {
    const w = new Date(d).getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const dateRange = (s: string, e: string) => (s === e ? fmtDate(s) : `${fmtDate(s)} – ${fmtDate(e)}`);

function Tabs<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl bg-violet-tint/70 p-1">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`h-9 rounded-lg px-4 text-sm font-medium ${
            value === o.value ? 'bg-white text-ink shadow-sm' : 'text-body hover:text-ink'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const TypePill = ({ children }: { children: string }) => (
  <span className="rounded-full bg-violet-tint px-2.5 py-0.5 text-xs font-semibold text-violet-text">{children}</span>
);

/* ---------- Review: managers and HR ---------- */
type Decided = 'pending' | 'approved' | 'rejected';
type ReviewRow = {
  id: string; startDate: string; endDate: string; days: number; reason: string | null; status: string;
  type: string; firstName: string; lastName: string; department: string | null;
  allocated: number | null; left: number | null;
};

function ReviewPanel() {
  const [status, setStatus] = useState<Decided>('pending');
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [counts, setCounts] = useState<Record<Decided, number>>({ pending: 0, approved: 0, rejected: 0 });
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() =>
    api<{ requests: ReviewRow[]; counts: Record<Decided, number> }>(`/leave/requests?status=${status}`)
      .then((d) => { setRows(d.requests); setCounts(d.counts); })
      .catch((e: Error) => setError(e.message)), [status]);

  useEffect(() => { load(); }, [load]);

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setBusyId(id);
    setError('');
    try {
      await api(`/leave/${id}/decide`, { method: 'POST', body: JSON.stringify({ decision }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="space-y-4">
      <Tabs value={status} onChange={setStatus} options={[
        { value: 'pending', label: `Pending (${counts.pending})` },
        { value: 'approved', label: `Approved (${counts.approved})` },
        { value: 'rejected', label: `Rejected (${counts.rejected})` },
      ]} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <div className="space-y-3">
        {rows?.map((r) => (
          <Card key={r.id} className="flex flex-wrap items-center gap-4 p-5">
            <Avatar first={r.firstName} last={r.lastName} size="size-10 text-sm" />
            <div className="min-w-0 flex-[1_1_260px] space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{r.firstName} {r.lastName}</span>
                <TypePill>{r.type}</TypePill>
                {r.department && <span className="text-xs text-muted">{r.department}</span>}
              </div>
              <div className="text-sm text-body">{dateRange(r.startDate, r.endDate)} · {plural(r.days, 'day')}</div>
              <div className="text-sm text-muted">
                {r.reason ? `“${r.reason}”` : 'No reason given'}
                {r.left !== null && ` · ${r.left} of ${r.allocated} days left`}
              </div>
            </div>
            {r.status === 'pending' ? (
              <div className="flex gap-2">
                <button disabled={busyId === r.id} onClick={() => decide(r.id, 'rejected')}
                  className={`${btnSecondary} h-10 text-red-700`}>Reject</button>
                <button disabled={busyId === r.id} onClick={() => decide(r.id, 'approved')}
                  className={`${btnPrimary} h-10`}>Approve</button>
              </div>
            ) : (
              <StatusBadge status={r.status} />
            )}
          </Card>
        ))}
        {rows?.length === 0 && (
          <Card className="border-dashed p-10 text-center text-sm text-muted">
            {status === 'pending' ? "Nothing to review. You're all caught up." : 'No requests here yet.'}
          </Card>
        )}
      </div>
    </div>
  );
}

/* ---------- My leave: everyone ---------- */
type Balance = { leaveTypeId: string; name: string; allocated: number; used: number };
type MyRequest = {
  id: string; leaveTypeId: string; type: string; startDate: string; endDate: string;
  days: number; status: string; reason: string | null;
};
const today = () => new Date().toISOString().slice(0, 10);

function MyLeave() {
  const [data, setData] = useState<{ balances: Balance[]; requests: MyRequest[] } | null>(null);
  const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ leaveTypeId: '', startDate: today(), endDate: today(), reason: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() =>
    api<{ balances: Balance[]; requests: MyRequest[] }>('/leave/my')
      .then(setData).catch((e: Error) => setError(e.message)), []);

  useEffect(() => {
    load();
    api<{ types: { id: string; name: string }[] }>('/leave/types').then((d) => {
      setTypes(d.types);
      setForm((f) => ({ ...f, leaveTypeId: f.leaveTypeId || d.types[0]?.id || '' }));
    }).catch(() => {});
  }, [load]);

  const days = form.startDate && form.endDate && form.endDate >= form.startDate
    ? workdays(form.startDate, form.endDate) : 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/leave', { method: 'POST', body: JSON.stringify(form) });
      setOpen(false);
      setForm((f) => ({ ...f, startDate: today(), endDate: today(), reason: '' }));
      setNotice('Leave request sent for approval.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setError('');
    try {
      await api(`/leave/${id}/cancel`, { method: 'POST' });
      setNotice('Request cancelled.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  const pendingDays = (typeId: string) =>
    data?.requests.filter((r) => r.status === 'pending' && r.leaveTypeId === typeId)
      .reduce((sum, r) => sum + r.days, 0) ?? 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        {data?.balances.map((b) => {
          const left = Math.max(0, b.allocated - b.used);
          const pending = pendingDays(b.leaveTypeId);
          return (
            <Card key={b.leaveTypeId} className="space-y-3 p-5">
              <div className="text-sm text-muted">{b.name}</div>
              <div className="font-display text-3xl font-semibold">
                {left}<span className="text-base font-normal text-muted"> of {b.allocated} days</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-violet-tint">
                <div className="h-2 rounded-full bg-brand" style={{ width: `${b.allocated ? (left / b.allocated) * 100 : 0}%` }} />
              </div>
              {pending > 0 && <div className="text-xs text-amber-700">{plural(pending, 'day')} pending</div>}
            </Card>
          );
        })}
      </div>

      {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
      {error && !open && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {open ? (
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">File leave</h2>
            <button type="button" aria-label="Close" onClick={() => { setOpen(false); setError(''); }}
              className="rounded-lg p-1.5 text-muted hover:bg-paper"><X size={18} /></button>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-sm font-medium">Leave type
                <select value={form.leaveTypeId} onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}
                  className={`${inputCls} mt-1.5`}>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">From
                <input type="date" required value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: e.target.value > form.endDate ? e.target.value : form.endDate })}
                  className={`${inputCls} mt-1.5`} />
              </label>
              <label className="block text-sm font-medium">To
                <input type="date" required min={form.startDate} value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  className={`${inputCls} mt-1.5`} />
              </label>
            </div>
            <label className="block text-sm font-medium">Reason (optional)
              <textarea rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Family trip to Bohol"
                className="mt-1.5 w-full rounded-[10px] border border-field bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100" />
            </label>
            <p className="text-sm text-muted">
              {days ? `${plural(days, 'working day')} (weekends don't count)` : 'Pick dates that include a weekday.'}
            </p>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => { setOpen(false); setError(''); }} className={btnSecondary}>Cancel</button>
              <button disabled={busy || !days} className={btnPrimary}>{busy ? 'Sending…' : 'Send request'}</button>
            </div>
          </form>
        </Card>
      ) : (
        <button type="button" onClick={() => { setOpen(true); setNotice(''); }} className={btnPrimary}>
          <Plus size={18} aria-hidden="true" /> File leave
        </button>
      )}

      <Card className="p-6">
        <h2 className="mb-2 font-semibold">My requests</h2>
        <ul className="divide-y divide-line">
          {data?.requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <TypePill>{r.type}</TypePill> {dateRange(r.startDate, r.endDate)} · {plural(r.days, 'day')}
                </div>
                {r.reason && <div className="mt-1 text-xs text-muted">{r.reason}</div>}
              </div>
              {r.status === 'pending' && (
                <button onClick={() => cancel(r.id)} className="text-sm text-muted hover:text-red-700">Cancel</button>
              )}
              <StatusBadge status={r.status} />
            </li>
          ))}
        </ul>
        {data?.requests.length === 0 && <p className="py-4 text-sm text-muted">No leave requests yet.</p>}
      </Card>
    </div>
  );
}

/* ---------- Page ---------- */
export default function Leave() {
  const { user } = useAuth();
  const canReview = user?.role === 'admin' || user?.role === 'manager';
  const [view, setView] = useState<'review' | 'mine'>(canReview ? 'review' : 'mine');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Leave</h1>
          <p className="mt-1 text-sm text-muted">
            {view === 'mine'
              ? 'Check your balance and file leave.'
              : user?.role === 'manager'
                ? "Approve or reject your team's requests."
                : 'Approve or reject leave requests.'}
          </p>
        </div>
        {canReview && (
          <Tabs value={view} onChange={setView} options={[
            { value: 'review', label: 'To review' },
            { value: 'mine', label: 'My leave' },
          ]} />
        )}
      </div>
      {view === 'review' ? <ReviewPanel /> : <MyLeave />}
    </div>
  );
}