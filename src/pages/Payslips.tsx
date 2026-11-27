import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, ChevronRight, Printer } from 'lucide-react';
import { api } from '../lib/api';
import { Card, btnSecondary, peso } from '../components/ui';

type Item = { id: string; periodStart: string; periodEnd: string; payDate: string; gross: number; net: number };
type Line = { label: string; amount: number; kind: 'earning' | 'deduction' };
type Summary = { absentDays?: number; lateMinutes?: number; undertimeMinutes?: number; nightMinutes?: number; leaveDays?: number };
type Slip = {
  id: string; monthlyRate: number; gross: number; taxable: number; totalDeductions: number; net: number;
  periodStart: string; periodEnd: string; payDate: string; status: 'draft' | 'finalized';
  firstName: string; lastName: string; employeeNo: string;
  position: string | null; department: string | null; company: string;
  details: { lines: Line[]; employerShare: number; summary?: Summary };
};

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
const range = (a: string, b: string) => `${day(a)} – ${day(b)}, ${a.slice(0, 4)}`;
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export default function Payslips() {
  const { id } = useParams();
  return id ? <PayslipView id={id} /> : <PayslipList />;
}

function PayslipList() {
  const [list, setList] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ payslips: Item[] }>('/payroll/my').then((d) => setList(d.payslips)).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!list) return <p className="text-sm text-muted">Loading…</p>;
  const latest = list[0];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Payslips</h1>
        <p className="mt-1 text-sm text-muted">Released after each cutoff · 15th and end of month</p>
      </div>

      {latest && (
        <Link to={`/payslips/${latest.id}`} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-brand p-6 text-white">
          <div>
            <div className="text-sm text-violet-100">Latest net pay</div>
            <div className="font-display text-3xl font-semibold">{peso(latest.net)}</div>
            <div className="text-sm text-violet-100">{range(latest.periodStart, latest.periodEnd)} · paid {day(latest.payDate)}</div>
          </div>
          <span className="inline-flex h-11 items-center rounded-[10px] bg-white px-4 text-sm font-semibold text-violet-text">View payslip</span>
        </Link>
      )}

      <Card className="divide-y divide-line">
        {list.map((p) => (
          <Link key={p.id} to={`/payslips/${p.id}`} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-paper">
            <div>
              <div className="font-semibold">{range(p.periodStart, p.periodEnd)}</div>
              <div className="text-sm text-muted">Paid {day(p.payDate)} · Gross {peso(p.gross)}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold tabular-nums">{peso(p.net)}</span>
              <ChevronRight size={16} className="text-muted" aria-hidden="true" />
            </div>
          </Link>
        ))}
        {list.length === 0 && (
          <p className="p-8 text-center text-sm text-muted">No payslips yet. They show up here once Finance releases a pay run.</p>
        )}
      </Card>
    </div>
  );
}

function PayslipView({ id }: { id: string }) {
  const navigate = useNavigate();
  const [slip, setSlip] = useState<Slip | null>(null);
  const [ratesYear, setRatesYear] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    setSlip(null);
    api<{ payslip: Slip; ratesYear: number }>(`/payroll/payslips/${id}`)
      .then((d) => { setSlip(d.payslip); setRatesYear(d.ratesYear); })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!slip) return <p className="text-sm text-muted">Loading…</p>;

  const earnings = slip.details.lines.filter((l) => l.kind === 'earning');
  const deductions = slip.details.lines.filter((l) => l.kind === 'deduction');
  const s = slip.details.summary ?? {};
  const notes = [
    s.absentDays ? `${plural(s.absentDays, 'day')} absent` : '',
    s.lateMinutes ? `${mins(s.lateMinutes)} late` : '',
    s.undertimeMinutes ? `${mins(s.undertimeMinutes)} undertime` : '',
    s.leaveDays ? `${plural(s.leaveDays, 'day')} paid leave` : '',
    s.nightMinutes ? `${mins(s.nightMinutes)} night work` : '',
  ].filter(Boolean);
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/payslips'));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button onClick={back} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-violet-text">
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </button>
        <button onClick={() => window.print()} className={btnSecondary}>
          <Printer size={16} aria-hidden="true" /> Print / Save as PDF
        </button>
      </div>

      {slip.status === 'draft' && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 print:hidden">
          Draft preview. The employee can't see this until the pay run is finalized.
        </p>
      )}

      <Card className="space-y-5 p-6 sm:p-8 print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-display text-xl font-semibold">{slip.company}</div>
            <div className="text-sm text-muted">Payslip</div>
          </div>
          <div className="text-right text-sm">
            <div className="font-semibold">{range(slip.periodStart, slip.periodEnd)}</div>
            <div className="text-muted">Pay date {day(slip.payDate)}</div>
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-3 rounded-xl bg-paper p-4 text-sm sm:grid-cols-2 [print-color-adjust:exact]">
          {([
            ['Employee', `${slip.firstName} ${slip.lastName}`],
            ['Employee no.', slip.employeeNo],
            ['Position', slip.position ?? '—'],
            ['Department', slip.department ?? '—'],
            ['Monthly rate', peso(slip.monthlyRate)],
          ] as const).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Earnings</h2>
          {earnings.map((l) => (
            <div key={l.label} className="flex justify-between gap-3 text-sm tabular-nums">
              <span className="text-body">{l.label}</span>
              <span className={l.amount < 0 ? 'text-red-700' : ''}>{l.amount < 0 ? `−${peso(-l.amount)}` : peso(l.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-line pt-2 text-sm font-semibold tabular-nums">
            <span>Gross pay</span><span>{peso(slip.gross)}</span>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Deductions</h2>
          {deductions.map((l) => (
            <div key={l.label} className="flex justify-between gap-3 text-sm tabular-nums">
              <span className="text-body">{l.label}</span><span>{peso(l.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-line pt-2 text-sm font-semibold tabular-nums">
            <span>Total deductions</span><span>{peso(slip.totalDeductions)}</span>
          </div>
        </section>

        <div className="flex items-center justify-between rounded-xl bg-brand px-5 py-4 text-white [print-color-adjust:exact]">
          <span>Net pay</span>
          <span className="font-display text-3xl font-semibold tabular-nums">{peso(slip.net)}</span>
        </div>

        <div className="space-y-1 text-sm">
          <div className="font-semibold">Attendance this cutoff</div>
          <p className="text-body">{notes.length ? notes.join(' · ') : 'Complete attendance, no late or absences.'}</p>
        </div>

        <div className="space-y-1 border-t border-line pt-4 text-xs text-muted">
          <p>Your employer also paid {peso(slip.details.employerShare)} in SSS, PhilHealth and Pag-IBIG contributions for you. This is not deducted from your pay.</p>
          <p>Computed with {ratesYear} government rates. System-generated payslip; no signature needed.</p>
        </div>
      </Card>
    </div>
  );
}