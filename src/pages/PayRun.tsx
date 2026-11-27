import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Download, RefreshCw, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { downloadCsv } from '../lib/csv';
import { Card, btnPrimary, btnSecondary, inputCls, peso } from '../components/ui';

type Adjustment = { kind: 'allowance' | 'bonus' | 'overtime' | 'deduction'; label: string; amount?: number; hours?: number };
type Line = { label: string; amount: number; kind: 'earning' | 'deduction' };
type Slip = {
  id: string; employeeId: string; firstName: string; lastName: string; employeeNo: string;
  department: string | null; shift: string | null; monthlyRate: number;
  gross: number; taxable: number; totalDeductions: number; net: number;
  details: { lines: Line[]; employerShare: number }; adjustments: Adjustment[];
};
type Data = {
  run: { id: string; periodStart: string; periodEnd: string; payDate: string; status: 'draft' | 'finalized' };
  payslips: Slip[]; ratesYear: number;
  totals: { gross: number; net: number; deductions: number; employer: number };
};

const KIND_LABEL: Record<Adjustment['kind'], string> = {
  allowance: 'Allowance (non-taxable)', bonus: 'Bonus or commission (taxable)',
  overtime: 'Overtime (hours)', deduction: 'Deduction (e.g. cash advance)',
};
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
const lineAmount = (s: Slip, label: string) => s.details.lines.find((l) => l.label === label)?.amount ?? 0;

export default function PayRun() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [selId, setSelId] = useState('');
  const [form, setForm] = useState({ kind: 'allowance' as Adjustment['kind'], label: '', value: '' });
  const [confirm, setConfirm] = useState<'' | 'finalize' | 'delete'>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() =>
    api<Data>(`/payroll/runs/${id}`).then((d) => {
      setData(d);
      setSelId((cur) => cur || d.payslips[0]?.id || '');
    }).catch((e: Error) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(false); setConfirm(''); }
  }

  if (!data) return error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <p className="text-sm text-muted">Loading…</p>;

  const { run, payslips, totals } = data;
  const draft = run.status === 'draft';
  const sel = payslips.find((p) => p.id === selId) ?? payslips[0];

  const saveAdjustments = (list: Adjustment[]) => act(() =>
    api(`/payroll/payslips/${sel.id}/adjustments`, { method: 'PUT', body: JSON.stringify({ adjustments: list }) }));

  function addItem() {
    const n = Number(form.value);
    if (!form.label.trim() || !n || n <= 0) { setError('Enter a name and an amount greater than 0.'); return; }
    const item: Adjustment = form.kind === 'overtime'
      ? { kind: 'overtime', label: form.label.trim(), hours: n }
      : { kind: form.kind, label: form.label.trim(), amount: n };
    saveAdjustments([...sel.adjustments, item]).then(() => setForm((f) => ({ ...f, label: '', value: '' })));
  }

  const exportCsv = () => downloadCsv(
    `payroll-${run.periodStart}-to-${run.periodEnd}.csv`,
    ['Employee no.', 'Employee', 'Department', 'Monthly rate', 'Gross', 'SSS', 'PhilHealth', 'Pag-IBIG', 'Withholding tax', 'Total deductions', 'Net pay'],
    payslips.map((s) => [
      s.employeeNo, `${s.firstName} ${s.lastName}`, s.department, s.monthlyRate, s.gross,
      lineAmount(s, 'SSS'), lineAmount(s, 'PhilHealth'), lineAmount(s, 'Pag-IBIG'), lineAmount(s, 'Withholding tax'),
      s.totalDeductions, s.net,
    ]),
  );

  return (
    <div className="space-y-5">
      <Link to="/payroll" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-violet-text">
        <ArrowLeft size={16} aria-hidden="true" /> All pay runs
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {day(run.periodStart)} – {day(run.periodEnd)}, {run.periodStart.slice(0, 4)}
            </h1>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${draft ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
              {draft ? 'Draft' : 'Finalized'}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">Pay date {day(run.payDate)} · {payslips.length} employees · computed from attendance, leave and shifts</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportCsv} className={btnSecondary}><Download size={16} aria-hidden="true" /> Export CSV</button>
          {draft && (
            <>
              <button disabled={busy} onClick={() => act(() => api(`/payroll/runs/${run.id}/recalculate`, { method: 'POST' }))} className={btnSecondary}>
                <RefreshCw size={16} aria-hidden="true" /> Recalculate
              </button>
              <button disabled={busy} onClick={() => setConfirm('finalize')} className={btnPrimary}>Finalize and release payslips</button>
            </>
          )}
        </div>
      </div>

      {confirm && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-violet-200 p-4">
          <p className="text-sm">
            {confirm === 'finalize'
              ? 'Finalize this pay run? Payslips become visible to employees and the run can no longer be changed.'
              : 'Delete this draft pay run? You can create it again anytime.'}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConfirm('')} className={`${btnSecondary} h-10`}>Cancel</button>
            {confirm === 'finalize' ? (
              <button disabled={busy} onClick={() => act(() => api(`/payroll/runs/${run.id}/finalize`, { method: 'POST' }))} className={`${btnPrimary} h-10`}>Yes, finalize</button>
            ) : (
              <button disabled={busy}
                onClick={() => act(async () => { await api(`/payroll/runs/${run.id}`, { method: 'DELETE' }); navigate('/payroll'); })}
                className="h-10 rounded-[10px] bg-red-50 px-4 text-sm font-semibold text-red-700 hover:bg-red-100">Yes, delete</button>
            )}
          </div>
        </Card>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        {([['Gross pay', totals.gross], ['Deductions', totals.deductions], ['Net pay', totals.net], ['Employer contributions', totals.employer]] as const).map(([label, n]) => (
          <Card key={label} className="p-4">
            <div className="text-sm text-muted">{label}</div>
            <div className="mt-1 font-display text-2xl font-semibold">{peso(n)}</div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <Card className="min-w-0 flex-[999_1_560px] overflow-x-auto">
          <table className="w-full min-w-180 text-sm tabular-nums">
            <thead>
              <tr className="bg-paper text-left text-xs text-muted">
                <th className="px-4 py-3 font-medium">Employee</th><th className="font-medium">Basic</th>
                <th className="font-medium">Gross</th><th className="font-medium">Gov’t + tax</th>
                <th className="pr-4 font-medium">Net pay</th>
              </tr>
            </thead>
            <tbody>
              {payslips.map((s) => (
                <tr key={s.id} onClick={() => setSelId(s.id)}
                  className={`cursor-pointer border-t border-line ${s.id === sel?.id ? 'bg-violet-tint/50' : 'hover:bg-paper'}`}>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{s.firstName} {s.lastName}</div>
                    <div className="text-xs text-muted">{s.department ?? '—'} · {s.shift ?? 'Day'} shift</div>
                  </td>
                  <td>{peso(s.monthlyRate / 2)}</td>
                  <td>{peso(s.gross)}</td>
                  <td className="text-body">−{peso(s.totalDeductions)}</td>
                  <td className="pr-4 font-bold">{peso(s.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {payslips.length === 0 && <p className="p-8 text-center text-sm text-muted">No employees with a monthly rate.</p>}
        </Card>

        {sel && (
          <Card className="flex-[1_1_320px] space-y-3 p-5">
            <div>
              <div className="font-display text-xl font-semibold">{sel.firstName} {sel.lastName}</div>
              <div className="text-sm text-muted">{sel.employeeNo} · {peso(sel.monthlyRate)} / month</div>
            </div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Earnings</div>
            {sel.details.lines.filter((l) => l.kind === 'earning').map((l) => (
              <div key={l.label} className="flex justify-between gap-3 text-sm tabular-nums">
                <span className="text-body">{l.label}</span>
                <span className={l.amount < 0 ? 'text-red-700' : ''}>{l.amount < 0 ? `−${peso(-l.amount)}` : peso(l.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-line pt-2 text-sm font-semibold"><span>Gross pay</span><span>{peso(sel.gross)}</span></div>
            <div className="pt-1 text-xs font-semibold uppercase tracking-wider text-muted">Deductions</div>
            {sel.details.lines.filter((l) => l.kind === 'deduction').map((l) => (
              <div key={l.label} className="flex justify-between gap-3 text-sm tabular-nums">
                <span className="text-body">{l.label}</span><span>{peso(l.amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-xl bg-brand px-4 py-3 text-white">
              <span className="text-sm">Net pay</span>
              <span className="font-display text-2xl font-semibold">{peso(sel.net)}</span>
            </div>
            <p className="text-xs text-muted">Employer also pays {peso(sel.details.employerShare)} in contributions.</p>

            {draft && (
              <div className="space-y-2 border-t border-line pt-3">
                <div className="text-sm font-semibold">Manual items</div>
                {sel.adjustments.map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-lg bg-paper px-3 py-2 text-sm">
                    <span className="truncate">{a.label} · {a.kind === 'overtime' ? `${a.hours} h` : peso(a.amount ?? 0)}</span>
                    <button aria-label={`Remove ${a.label}`} disabled={busy}
                      onClick={() => saveAdjustments(sel.adjustments.filter((_, j) => j !== i))}
                      className="rounded p-1 text-muted hover:text-red-700"><X size={14} /></button>
                  </div>
                ))}
                <label className="block text-xs font-medium text-muted">Type
                  <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Adjustment['kind'] })} className={`${inputCls} mt-1 h-10 text-sm`}>
                    {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <div className="flex gap-2">
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Name</span>
                    <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
                      placeholder={form.kind === 'deduction' ? 'Cash advance' : form.kind === 'overtime' ? 'Overtime' : 'Rice allowance'}
                      className={`${inputCls} h-10 text-sm`} />
                  </label>
                  <label className="w-28">
                    <span className="sr-only">{form.kind === 'overtime' ? 'Hours' : 'Amount'}</span>
                    <input type="number" min="0" step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })}
                      placeholder={form.kind === 'overtime' ? 'Hours' : '₱'} className={`${inputCls} h-10 text-sm`} />
                  </label>
                </div>
                <button disabled={busy} onClick={addItem} className={`${btnSecondary} h-10 w-full`}>{busy ? 'Saving…' : 'Add item'}</button>
              </div>
            )}
          </Card>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">Rates as of {data.ratesYear}. Verify with your accountant before releasing pay.</p>
        {draft && (
          <button onClick={() => setConfirm('delete')} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-red-700">
            <Trash2 size={14} aria-hidden="true" /> Delete draft
          </button>
        )}
      </div>
    </div>
  );
}