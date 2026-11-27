import { describe, expect, it } from 'vitest';
import { computePay, pagibig, philhealth, sss, withholdingSemiMonthly } from './payroll';
import { DEFAULT_SHIFT, type Shift } from './shifts';

// A Manila clock time on a date, e.g. at('2026-11-05', 8 * 60 + 23) = 8:23 AM
const at = (d: string, minutes: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) - 8 * 3_600_000 + minutes * 60_000);
const WEEKDAYS = ['02', '03', '04', '05', '06', '09', '10', '11', '12', '13'].map((d) => `2026-11-${d}`);
const dayLogs = (skip: string[] = [], lateOn?: string) =>
  WEEKDAYS.filter((d) => !skip.includes(d)).map((d) => ({
    workDate: d, status: 'present',
    timeIn: at(d, d === lateOn ? 8 * 60 + 23 : 7 * 60 + 50),
    timeOut: at(d, 17 * 60 + 5),
  }));
const base = {
  monthlyRate: 28000, shift: DEFAULT_SHIFT, hireDate: '2021-03-08',
  periodStart: '2026-11-01', periodEnd: '2026-11-15', today: '2026-11-27',
  leaveDates: new Set<string>(), adjustments: [],
};

describe('government contributions (2026)', () => {
  it('SSS uses the right salary credit and shares', () => {
    expect(sss(28000)).toEqual({ msc: 28000, employee: 1400, employer: 2830 });
    expect(sss(4000)).toEqual({ msc: 5000, employee: 250, employer: 510 });
    expect(sss(50000)).toEqual({ msc: 35000, employee: 1750, employer: 3530 });
    expect(sss(14749.99).msc).toBe(14500);
    expect(sss(14750).msc).toBe(15000);
  });
  it('PhilHealth is 5% split equally, with floor and ceiling', () => {
    expect(philhealth(28000).employee).toBe(700);
    expect(philhealth(8000).employee).toBe(250);
    expect(philhealth(150000).employee).toBe(2500);
  });
  it('Pag-IBIG is capped at ₱200', () => {
    expect(pagibig(28000)).toEqual({ employee: 200, employer: 200 });
    expect(pagibig(8000)).toEqual({ employee: 160, employer: 160 });
    expect(pagibig(1200)).toEqual({ employee: 12, employer: 24 });
  });
  it('withholding tax follows the BIR semi-monthly table', () => {
    expect(withholdingSemiMonthly(10000)).toBe(0);
    expect(withholdingSemiMonthly(10417)).toBe(0);
    expect(withholdingSemiMonthly(12788.31)).toBe(355.7);
    expect(withholdingSemiMonthly(25837.5)).toBe(2771.6);
    expect(withholdingSemiMonthly(40000)).toBe(5937.45);
  });
});

describe('payslip computation', () => {
  it("matches Juan's prototype payslip", () => {
    const r = computePay({
      ...base, logs: dayLogs([], '2026-11-05'),
      adjustments: [{ kind: 'allowance', label: 'Rice allowance', amount: 1000 }],
    });
    expect(r.summary.lateMinutes).toBe(23);
    expect(r.gross).toBe(14938.31);
    expect(r.taxable).toBe(12788.31);
    expect(r.totalDeductions).toBe(1505.7);
    expect(r.net).toBe(13432.61);
    expect(r.employerShare).toBe(1865);
  });
  it('deducts one day for an absence', () => {
    const r = computePay({ ...base, logs: dayLogs(['2026-11-10']) });
    expect(r.summary.absentDays).toBe(1);
    expect(r.lines.find((l) => l.label.startsWith('Absences'))?.amount).toBe(-1287.36);
  });
  it('does not deduct approved leave', () => {
    const r = computePay({ ...base, logs: dayLogs(['2026-11-03']), leaveDates: new Set(['2026-11-03']) });
    expect(r.summary.leaveDays).toBe(1);
    expect(r.summary.absentDays).toBe(0);
  });
  it('pays night differential for a 10 PM – 7 AM shift', () => {
    const night: Shift = { id: 'n', name: 'Night', startMinute: 1320, endMinute: 420, graceMinutes: 10 };
    const r = computePay({
      ...base, shift: night, periodEnd: '2026-11-02',
      logs: [{ workDate: '2026-11-02', status: 'present', timeIn: at('2026-11-02', 21 * 60 + 50), timeOut: at('2026-11-02', 1440 + 7 * 60) }],
    });
    expect(r.summary.nightMinutes).toBe(480); // 10 PM to 6 AM
    expect(r.summary.lateMinutes).toBe(0);
  });
  it('adds overtime at 125%', () => {
    const r = computePay({ ...base, logs: dayLogs(), adjustments: [{ kind: 'overtime', label: 'Overtime', hours: 2 }] });
    expect(r.lines.find((l) => l.label.startsWith('Overtime'))?.amount).toBe(402.3);
  });
});