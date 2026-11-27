import { type Shift, MNL, addDays, isWeekend, shiftEndMs, shiftStartMs } from './shifts';

// Government rates for 2026. Update this file when the law changes.
export const RATES_YEAR = 2026;

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// SSS: 15% of Monthly Salary Credit (5% employee, 10% employer + EC), MSC ₱5,000–₱35,000 in ₱500 steps
export function sss(monthly: number) {
  const msc = clamp(Math.round(monthly / 500) * 500, 5000, 35000);
  return { msc, employee: round2(msc * 0.05), employer: round2(msc * 0.1 + (msc <= 14500 ? 10 : 30)) };
}

// PhilHealth: 5% of basic salary (₱10,000 floor, ₱100,000 ceiling), split equally
export function philhealth(monthly: number) {
  const premium = clamp(monthly, 10000, 100000) * 0.05;
  return { employee: round2(premium / 2), employer: round2(premium / 2) };
}

// Pag-IBIG: 2% each on a fund salary capped at ₱10,000 (employee 1% if ₱1,500 or below)
export function pagibig(monthly: number) {
  const base = Math.min(monthly, 10000);
  return { employee: round2(monthly <= 1500 ? monthly * 0.01 : base * 0.02), employer: round2(base * 0.02) };
}

// BIR TRAIN withholding table (effective 2023), semi-monthly column: [over, base tax, rate on excess]
const SEMI_MONTHLY_TAX: [number, number, number][] = [
  [10417, 0, 0.15],
  [16667, 937.5, 0.2],
  [33333, 4270.7, 0.25],
  [83333, 16770.7, 0.3],
  [333333, 91770.7, 0.35],
];
export function withholdingSemiMonthly(taxable: number) {
  for (let i = SEMI_MONTHLY_TAX.length - 1; i >= 0; i--) {
    const [over, base, rate] = SEMI_MONTHLY_TAX[i];
    if (taxable > over) return round2(base + (taxable - over) * rate);
  }
  return 0;
}

// Minutes worked between 10 PM and 6 AM (Manila time)
function nightMinutes(inMs: number, outMs: number, workDate: string) {
  const midnight = Date.parse(`${workDate}T00:00:00Z`) - MNL;
  let total = 0;
  for (const k of [-1, 0, 1]) {
    const start = midnight + (22 * 60 + k * 1440) * 60_000;
    const end = start + 8 * 3_600_000;
    total += Math.max(0, Math.min(outMs, end) - Math.max(inMs, start));
  }
  return Math.floor(total / 60_000);
}

const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

export type Adjustment = {
  kind: 'allowance' | 'bonus' | 'overtime' | 'deduction';
  label: string;
  amount?: number; // pesos (allowance, bonus, deduction)
  hours?: number;  // overtime hours
};
export type DayLog = { workDate: string; timeIn: Date | null; timeOut: Date | null; status: string };
export type PayInput = {
  monthlyRate: number;
  shift: Shift;
  hireDate: string;
  periodStart: string;
  periodEnd: string;
  today: string;
  logs: DayLog[];
  leaveDates: Set<string>;
  adjustments: Adjustment[];
};
export type Line = { label: string; amount: number; kind: 'earning' | 'deduction' };

export function computePay(p: PayInput) {
  const daily = (p.monthlyRate * 12) / 261; // 5-day work week
  const hourly = daily / 8;
  const perMinute = hourly / 60;
  const logs = new Map(p.logs.map((l) => [l.workDate, l]));

  let absentDays = 0, lateMinutes = 0, undertimeMinutes = 0, nightMins = 0, leaveDays = 0;
  for (let d = p.periodStart; d <= p.periodEnd; d = addDays(d, 1)) {
    if (isWeekend(d)) continue;
    const log = logs.get(d);
    if (p.leaveDates.has(d) || log?.status === 'on_leave') { leaveDays++; continue; }
    if (d < p.hireDate) { absentDays++; continue; } // not hired yet
    if (log?.timeIn) {
      const start = shiftStartMs(p.shift, d);
      const end = shiftEndMs(p.shift, d);
      const inMs = log.timeIn.getTime();
      if (inMs > start + p.shift.graceMinutes * 60_000) lateMinutes += Math.floor((inMs - start) / 60_000);
      const outMs = log.timeOut ? log.timeOut.getTime() : end; // forgot to clock out: count the full shift
      if (log.timeOut && outMs < end) undertimeMinutes += Math.floor((end - outMs) / 60_000);
      nightMins += nightMinutes(inMs, outMs, d);
      continue;
    }
    if (d >= p.today) continue; // today or later in an open period: not counted yet
    absentDays++;
  }

  const lines: Line[] = [];
  const earn = (label: string, amount: number) => { if (amount) lines.push({ label, amount: round2(amount), kind: 'earning' }); };
  earn('Basic pay (half month)', p.monthlyRate / 2);
  earn(`Absences (${absentDays} ${absentDays === 1 ? 'day' : 'days'})`, -absentDays * daily);
  earn(`Late (${lateMinutes} min)`, -lateMinutes * perMinute);
  earn(`Undertime (${undertimeMinutes} min)`, -undertimeMinutes * perMinute);
  earn(`Night differential (${hm(nightMins)})`, (nightMins / 60) * hourly * 0.1);

  let nonTaxable = 0;
  const otherDeductions: Line[] = [];
  for (const a of p.adjustments) {
    if (a.kind === 'overtime') earn(`${a.label} (${a.hours ?? 0} h × 125%)`, (a.hours ?? 0) * hourly * 1.25);
    else if (a.kind === 'allowance') { nonTaxable += a.amount ?? 0; earn(`${a.label} (non-taxable)`, a.amount ?? 0); }
    else if (a.kind === 'bonus') earn(a.label, a.amount ?? 0);
    else otherDeductions.push({ label: a.label, amount: round2(a.amount ?? 0), kind: 'deduction' });
  }
  const gross = round2(lines.reduce((s, l) => s + l.amount, 0));

  // Contributions are monthly amounts, split across the two cutoffs
  const S = sss(p.monthlyRate), PH = philhealth(p.monthlyRate), HD = pagibig(p.monthlyRate);
  const sssEe = round2(S.employee / 2), phEe = round2(PH.employee / 2), hdEe = round2(HD.employee / 2);
  const contributions = round2(sssEe + phEe + hdEe);
  const taxable = Math.max(0, round2(gross - nonTaxable - contributions));
  const tax = withholdingSemiMonthly(taxable);

  lines.push(
    { label: 'SSS', amount: sssEe, kind: 'deduction' },
    { label: 'PhilHealth', amount: phEe, kind: 'deduction' },
    { label: 'Pag-IBIG', amount: hdEe, kind: 'deduction' },
    { label: 'Withholding tax', amount: tax, kind: 'deduction' },
    ...otherDeductions,
  );
  const totalDeductions = round2(lines.filter((l) => l.kind === 'deduction').reduce((s, l) => s + l.amount, 0));

  return {
    gross, taxable, totalDeductions,
    net: round2(gross - totalDeductions),
    employerShare: round2((S.employer + PH.employer + HD.employer) / 2),
    lines,
    summary: { absentDays, lateMinutes, undertimeMinutes, nightMinutes: nightMins, leaveDays },
  };
}