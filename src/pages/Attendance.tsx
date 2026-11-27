import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { api } from '../lib/api';
import { downloadCsv } from '../lib/csv';
import {
  Avatar, Card, StatusBadge, btnSecondary, fmtHours, fmtTime, inputCls, statusLabel,
} from '../components/ui';

type Row = {
  id: string; firstName: string; lastName: string; department: string | null;
  timeIn: string | null; timeOut: string | null; status: string; shift: string; shiftLabel: string;
};
type Data = { date: string; today: string; employees: Row[]; counts: Record<string, number> };

const FILTERS: [string, string][] = [
  ['all', 'All'], ['present', 'Present'], ['late', 'Late'], ['not_in', 'Not in yet'],
  ['upcoming', 'Upcoming'], ['on_leave', 'On leave'], ['absent', 'Absent'],
];
const DAY = 86_400_000;
const LONG_DAY = 12 * 3_600_000;
const isLong = (r: Row) => !!r.timeIn && !!r.timeOut && Date.parse(r.timeOut) - Date.parse(r.timeIn) > LONG_DAY;
type ExportRow = {
  workDate: string; employeeNo: string; firstName: string; lastName: string; department: string | null;
  shift: string | null; timeIn: string | null; timeOut: string | null; status: string;
};
const t = (iso: string | null) => (iso ? fmtTime(iso) : '');
const h = (a: string | null, b: string | null) => (a && b ? fmtHours(a, b) : '');

export default function Attendance() {
  const [date, setDate] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api<Data>(`/attendance/team${date ? `?date=${date}` : ''}`)
      .then((d) => { setData(d); setError(''); })
      .catch((e: Error) => setError(e.message));
  }, [date]);

  const shift = (n: number) => {
    if (!data) return;
    setDate(new Date(Date.parse(`${data.date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10));
  };

  const rows = data?.employees.filter((r) => filter === 'all' || r.status === filter) ?? [];
  const count = (key: string) => (key === 'all' ? data?.employees.length ?? 0 : data?.counts[key] ?? 0);

    const exportDay = () => {
    if (!data) return;
    downloadCsv(
      `attendance-${data.date}.csv`,
      ['Date', 'Employee', 'Department', 'Shift', 'Time in', 'Time out', 'Hours', 'Status'],
      data.employees.map((r) => [
        data.date, `${r.firstName} ${r.lastName}`, r.department, r.shift,
        t(r.timeIn), t(r.timeOut), h(r.timeIn, r.timeOut), statusLabel(r.status),
      ]),
    );
  };

  async function exportMonth() {
    if (!data) return;
    const [y, m] = data.date.split('-').map(Number);
    const from = `${data.date.slice(0, 8)}01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const to = lastDay < data.today ? lastDay : data.today;
    setExporting(true);
    setError('');
    try {
      const d = await api<{ rows: ExportRow[] }>(`/attendance/export?from=${from}&to=${to}`);
      downloadCsv(
        `attendance-${data.date.slice(0, 7)}.csv`,
        ['Date', 'Employee no.', 'Employee', 'Department', 'Shift', 'Time in', 'Time out', 'Hours', 'Status'],
        d.rows.map((r) => [
          r.workDate, r.employeeNo, `${r.firstName} ${r.lastName}`, r.department, r.shift ?? 'Day',
          t(r.timeIn), t(r.timeOut), h(r.timeIn, r.timeOut), statusLabel(r.status),
        ]),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Attendance</h1>
          <p className="mt-1 text-sm text-muted">
            {data ? new Date(`${data.date}T00:00:00`).toLocaleDateString('en-PH', {
              weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
            }) : 'Loading…'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button aria-label="Previous day" onClick={() => shift(-1)} className={`${btnSecondary} w-11 px-0`}>
            <ChevronLeft size={18} />
          </button>
          <label>
            <span className="sr-only">Date</span>
            <input type="date" value={data?.date ?? ''} max={data?.today}
              onChange={(e) => e.target.value && setDate(e.target.value)} className={`${inputCls} w-44`} />
          </label>
          <button aria-label="Next day" disabled={!data || data.date >= data.today}
            onClick={() => shift(1)} className={`${btnSecondary} w-11 px-0 disabled:opacity-50`}>
            <ChevronRight size={18} />
          </button>
          <button onClick={() => setDate('')} className={btnSecondary}>Today</button>
        </div>
      </div>

       <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setFilter(key)}
              className={`h-9 rounded-full border px-3.5 text-sm font-medium ${
                filter === key
                  ? 'border-violet-300 bg-violet-tint text-violet-text'
                  : 'border-field bg-white text-body hover:border-violet-300'
              }`}>
              {label} <span className="ml-1 text-muted">{count(key)}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportDay} disabled={!data} className={`${btnSecondary} h-9 disabled:opacity-50`}>
            <Download size={16} aria-hidden="true" /> Export day
          </button>
          <button type="button" onClick={exportMonth} disabled={!data || exporting} className={`${btnSecondary} h-9 disabled:opacity-50`}>
            <Download size={16} aria-hidden="true" /> {exporting ? 'Exporting…' : 'Export month'}
          </button>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-200 text-sm">
          <thead>
            <tr className="bg-paper text-left text-xs text-muted">
              <th className="px-5 py-3 font-medium">Employee</th>
              <th className="font-medium">Department</th>
              <th className="font-medium">Shift</th>
              <th className="font-medium">Time in</th>
              <th className="font-medium">Time out</th>
              <th className="font-medium">Hours</th>
              <th className="font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line tabular-nums">
                <td className="px-5 py-3">
                  <Link to={`/employees/${r.id}`} className="flex items-center gap-3 font-medium hover:text-violet-text">
                    <Avatar first={r.firstName} last={r.lastName} />
                    {r.firstName} {r.lastName}
                  </Link>
                </td>
                <td className="text-body">{r.department ?? '—'}</td>
                <td>
                  <div className="font-medium">{r.shift}</div>
                  <div className="text-xs text-muted">{r.shiftLabel}</div>
                </td>
                <td>{fmtTime(r.timeIn)}</td>
                <td>{fmtTime(r.timeOut)}</td>
                <td className={isLong(r) ? 'font-semibold text-amber-700' : ''}
                  title={isLong(r) ? 'Unusually long day. Check with the employee.' : undefined}>
                  {fmtHours(r.timeIn, r.timeOut)}{isLong(r) && ' ⚠'}
                </td>
                <td><StatusBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && rows.length === 0 && <p className="p-8 text-center text-sm text-muted">No one here.</p>}
      </Card>
    </div>
  );
}