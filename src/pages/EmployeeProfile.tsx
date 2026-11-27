import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Pencil } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import DocumentsCard from '../components/DocumentsCard';
import {
  Avatar, Card, EMPLOYMENT_LABEL, StatusBadge, btnSecondary, fmtDate, fmtTime, peso
} from '../components/ui';

type Detail = {
  employee: {
    id: string; employeeNo: string; firstName: string; lastName: string; email: string;
    phone: string | null; employmentType: string; status: string; hireDate: string;
    department: string | null; position: string | null;
    managerFirstName: string | null; managerLastName: string | null;
    shift: string | null;
    monthlyRate: number | null;
  };
  balances: { name: string; allocated: number; used: number }[];
  attendance: { workDate: string; timeIn: string | null; timeOut: string | null; status: string }[];
  leave: { id: string; type: string; startDate: string; endDate: string; days: number; status: string; reason: string | null }[];
};

export default function EmployeeProfile({ self = false }: { self?: boolean }) {
  const params = useParams();
  const { user } = useAuth();
  const id = self ? user?.employeeId ?? '' : params.id ?? '';
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api<Detail>(`/employees/${id}`).then(setData).catch((e: Error) => setError(e.message));
  }, [id]);

  if (!id) return <p className="text-sm text-muted">Your account isn't linked to an employee profile.</p>;

  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  const e = data.employee;
  const info: [string, string][] = [
    ['Employee no.', e.employeeNo],
    ['Email', e.email],
    ['Phone', e.phone ?? '—'],
    ['Department', e.department ?? '—'],
    ['Position', e.position ?? '—'],
    ['Manager', e.managerFirstName ? `${e.managerFirstName} ${e.managerLastName}` : '—'],
    ['Shift', e.shift ?? 'Day (default)'],
    ['Type', EMPLOYMENT_LABEL[e.employmentType]],
    ['Hired', fmtDate(e.hireDate)],
    ['Monthly rate', e.monthlyRate != null ? peso(e.monthlyRate) : '—'],
  ];

  return (
    <div className="space-y-5">
      {!self && (
        <Link to="/employees" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-violet-text">
          <ArrowLeft size={16} aria-hidden="true" /> All employees
        </Link>
      )}

      <Card className="flex flex-wrap items-center gap-4 p-6">
        <Avatar first={e.firstName} last={e.lastName} size="size-14 text-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl font-semibold tracking-tight">{e.firstName} {e.lastName}</h1>
            <StatusBadge status={e.status} />
          </div>
          <p className="text-sm text-muted">{e.position ?? 'No position'} · {e.department ?? 'No department'}</p>
        </div>
        {user?.role === 'admin' && (
          <Link to={`/employees/${e.id}/edit`} className={btnSecondary}>
            <Pencil size={16} aria-hidden="true" /> Edit
          </Link>
        )}
      </Card>

      <DocumentsCard employeeId={e.id} canManage={user?.role === 'admin'} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <h2 className="mb-4 font-semibold">Details</h2>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {info.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-0.5 text-sm font-medium wrap-break-word">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 font-semibold">Leave balance {new Date().getFullYear()}</h2>
          <div className="space-y-4">
            {data.balances.map((b) => {
              const left = Math.max(0, b.allocated - b.used);
              return (
                <div key={b.name}>
                  <div className="flex justify-between text-sm">
                    <span className="text-body">{b.name}</span>
                    <span className="font-semibold">{left} of {b.allocated} days</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-violet-tint">
                    <div className="h-2 rounded-full bg-brand"
                      style={{ width: `${b.allocated ? (left / b.allocated) * 100 : 0}%` }} />
                  </div>
                </div>
              );
            })}
            {data.balances.length === 0 && <p className="text-sm text-muted">No leave balances yet.</p>}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="overflow-x-auto p-6">
          <h2 className="mb-3 font-semibold">Recent attendance</h2>
          <table className="w-full min-w-105 text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 font-medium">Date</th><th className="font-medium">In</th>
                <th className="font-medium">Out</th><th className="font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.attendance.map((a) => (
                <tr key={a.workDate} className="border-t border-line tabular-nums">
                  <td className="py-2.5">{fmtDate(a.workDate)}</td>
                  <td>{fmtTime(a.timeIn)}</td>
                  <td>{fmtTime(a.timeOut)}</td>
                  <td><StatusBadge status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.attendance.length === 0 && <p className="py-4 text-sm text-muted">No attendance yet.</p>}
        </Card>

        <Card className="p-6">
          <h2 className="mb-3 font-semibold">Leave history</h2>
          <ul className="divide-y divide-line">
            {data.leave.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {l.type} · {l.days} {l.days === 1 ? 'day' : 'days'}
                  </div>
                  <div className="text-xs text-muted">
                    {fmtDate(l.startDate)}{l.endDate !== l.startDate && ` – ${fmtDate(l.endDate)}`}
                    {l.reason && ` · ${l.reason}`}
                  </div>
                </div>
                <StatusBadge status={l.status} />
              </li>
            ))}
          </ul>
          {data.leave.length === 0 && <p className="py-4 text-sm text-muted">No leave requests yet.</p>}
        </Card>
      </div>
    </div>
  );
}