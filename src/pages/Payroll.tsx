import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { Card, btnSecondary, peso } from '../components/ui';

type Run = {
  id: string; periodStart: string; periodEnd: string; payDate: string;
  status: 'draft' | 'finalized'; totalGross: number; totalNet: number; people: number;
};

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
const range = (a: string, b: string) => `${day(a)} – ${day(b)}, ${a.slice(0, 4)}`;
const lastDayOf = (d: string) => {
  const [y, m] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
// The semi-monthly cutoff that contains a date: 1–15 or 16–end of month
function cutoffFor(d: string) {
  const ym = d.slice(0, 8);
  return Number(d.slice(8)) <= 15
    ? { periodStart: `${ym}01`, periodEnd: `${ym}15`, payDate: `${ym}15` }
    : { periodStart: `${ym}16`, periodEnd: lastDayOf(d), payDate: lastDayOf(d) };
}
const previousCutoff = (c: { periodStart: string }) =>
  cutoffFor(new Date(Date.parse(`${c.periodStart}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10));

export default function Payroll() {
  const navigate = useNavigate();
  const [data, setData] = useState<{ runs: Run[]; ratesYear: number; today: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() =>
    api<{ runs: Run[]; ratesYear: number; today: string }>('/payroll/runs')
      .then(setData).catch((e: Error) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function create(period: { periodStart: string; periodEnd: string; payDate: string }) {
    setBusy(true);
    setError('');
    try {
      const d = await api<{ run: { id: string } }>('/payroll/runs', { method: 'POST', body: JSON.stringify(period) });
      navigate(`/payroll/${d.run.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <p className="text-sm text-muted">Loading…</p>;

  const current = cutoffFor(data.today);
  const previous = previousCutoff(current);
  const find = (p: { periodStart: string; periodEnd: string }) =>
    data.runs.find((r) => r.periodStart === p.periodStart && r.periodEnd === p.periodEnd);
  const currentRun = find(current);
  const previousRun = find(previous);
  const lastFinal = data.runs.find((r) => r.status === 'finalized');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Payroll</h1>
          <p className="mt-1 text-sm text-muted">Semi-monthly · cutoffs on the 15th and end of month</p>
        </div>
        {!previousRun && (
          <button disabled={busy} onClick={() => create(previous)} className={btnSecondary}>
            <Plus size={16} aria-hidden="true" /> Run previous cutoff ({range(previous.periodStart, previous.periodEnd)})
          </button>
        )}
      </div>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-brand p-6 text-white">
        <div>
          <div className="text-sm text-violet-100">Current cutoff</div>
          <div className="font-display text-2xl font-semibold">{range(current.periodStart, current.periodEnd)}</div>
          <div className="text-sm text-violet-100">
            Pay date {day(current.payDate)} · {currentRun ? (currentRun.status === 'draft' ? 'draft ready for review' : 'finalized') : 'not started yet'}
          </div>
        </div>
        {currentRun ? (
          <Link to={`/payroll/${currentRun.id}`} className="inline-flex h-11 items-center rounded-[10px] bg-white px-4 text-sm font-semibold text-violet-text">
            {currentRun.status === 'draft' ? 'Review draft' : 'View'}
          </Link>
        ) : (
          <button disabled={busy} onClick={() => create(current)}
            className="h-11 rounded-[10px] bg-white px-4 text-sm font-semibold text-violet-text disabled:opacity-70">
            {busy ? 'Computing…' : 'Create pay run'}
          </button>
        )}
      </section>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {lastFinal && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
          {([
            ['Last net payout', peso(lastFinal.totalNet)],
            ['Last gross pay', peso(lastFinal.totalGross)],
            ['Employees paid', String(lastFinal.people)],
            ['Last pay date', day(lastFinal.payDate)],
          ] as const).map(([label, value]) => (
            <Card key={label} className="p-4">
              <div className="text-sm text-muted">{label}</div>
              <div className="mt-1 font-display text-2xl font-semibold">{value}</div>
            </Card>
          ))}
        </div>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-180 text-sm">
          <thead>
            <tr className="bg-paper text-left text-xs text-muted">
              <th className="px-5 py-3 font-medium">Period</th><th className="font-medium">Pay date</th>
              <th className="font-medium">Employees</th><th className="font-medium">Gross pay</th>
              <th className="font-medium">Net pay</th><th className="font-medium">Status</th><th />
            </tr>
          </thead>
          <tbody>
            {data.runs.map((r) => (
              <tr key={r.id} className="border-t border-line tabular-nums">
                <td className="px-5 py-3 font-semibold">{range(r.periodStart, r.periodEnd)}</td>
                <td className="text-body">{day(r.payDate)}</td>
                <td className="text-body">{r.people}</td>
                <td>{peso(r.totalGross)}</td>
                <td className="font-semibold">{peso(r.totalNet)}</td>
                <td>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${r.status === 'draft' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                    {r.status === 'draft' ? 'Draft' : 'Finalized'}
                  </span>
                </td>
                <td className="pr-5 text-right">
                  <Link to={`/payroll/${r.id}`} className="text-sm font-semibold text-violet-text hover:underline">
                    {r.status === 'draft' ? 'Review' : 'View'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.runs.length === 0 && <p className="p-8 text-center text-sm text-muted">No pay runs yet. Create one for the current cutoff.</p>}
      </Card>

      <p className="text-xs text-muted">
        Government rates as of {data.ratesYear}: SSS 5% employee share (₱5,000–₱35,000 salary credit), PhilHealth 2.5%
        (₱10,000–₱100,000 base), Pag-IBIG 2% (max ₱200), BIR TRAIN semi-monthly table. Verify with your accountant before releasing pay.
      </p>
    </div>
  );
}