import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CalendarDays, Clock, Plus, UserCheck, UserX, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Avatar, Card, StatusBadge, btnPrimary, fmtDate, fmtTime } from '../components/ui';

type Person = { firstName: string; lastName: string };
type Data = {
  firstName: string;
  today: string;
  stats: {
    employees: number; newThisMonth: number; present: number; late: number;
    onLeave: number; pending: number; notIn: number;
  };
  pending: (Person & { id: string; startDate: string; endDate: string; days: number; type: string })[];
  departments: { name: string; count: number }[];
  recentClockIns: (Person & { employeeId: string; timeIn: string | null; status: string; department: string | null })[];
  onLeaveToday: (Person & { employeeId: string; type: string; endDate: string })[];
};

const greeting = () => {
  const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' }));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};
const range = (s: string, e: string) => (s === e ? fmtDate(s) : `${fmtDate(s)} – ${fmtDate(e)}`);

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Data>('/dashboard').then(setData).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  const s = data.stats;
  const canReview = user?.role === 'admin' || user?.role === 'manager';
  const maxDept = Math.max(1, ...data.departments.map((d) => d.count));
  const team = user?.role === 'manager' ? 'Your team' : 'Employees';

  const cards = [
    { label: team, value: s.employees, note: `+${s.newThisMonth} this month`, icon: Users, to: user?.role === 'manager' ? '/attendance' : '/employees' },
    { label: 'Present today', value: s.present, note: `${s.late} late`, icon: UserCheck, to: '/attendance' },
    { label: 'On leave today', value: s.onLeave, note: 'Approved leave', icon: CalendarDays, to: '/attendance' },
    { label: 'Pending approvals', value: s.pending, note: 'Leave requests', icon: Clock, to: canReview ? '/leave' : '/dashboard' },
    { label: 'Not clocked in', value: s.notIn, note: 'Includes later shifts', icon: UserX, to: '/attendance' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm text-muted">
            {new Date(`${data.today}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {greeting()}{data.firstName && `, ${data.firstName}`}
          </h1>
        </div>
        {user?.role === 'admin' && (
          <Link to="/employees/new" className={btnPrimary}>
            <Plus size={18} aria-hidden="true" /> Add employee
          </Link>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 sm:gap-4">
        {cards.map(({ label, value, note, icon: Icon, to }) => (
          <Link key={label} to={to}
            className="rounded-2xl border border-line bg-white p-5 transition hover:border-violet-300">
            <div className="flex items-center justify-between text-sm text-muted">
              {label}
              <Icon size={18} strokeWidth={1.8} className="text-violet-text" aria-hidden="true" />
            </div>
            <div className="mt-2 font-display text-3xl font-semibold">{value}</div>
            <div className="mt-1 text-xs text-muted">{note}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Pending approvals</h2>
            {canReview && <Link to="/leave" className="text-sm text-violet-text hover:underline">Review all</Link>}
          </div>
          <ul className="divide-y divide-line">
            {data.pending.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-3">
                <Avatar first={p.firstName} last={p.lastName} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{p.firstName} {p.lastName}</div>
                  <div className="text-xs text-muted">
                    {p.type} · {range(p.startDate, p.endDate)} · {p.days} {p.days === 1 ? 'day' : 'days'}
                  </div>
                </div>
                <StatusBadge status="pending" />
              </li>
            ))}
          </ul>
          {data.pending.length === 0 && <p className="py-3 text-sm text-muted">Nothing waiting. You're all caught up.</p>}
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 font-semibold">Headcount by department</h2>
          <div className="space-y-3">
            {data.departments.map((d) => (
              <div key={d.name} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 truncate text-body">{d.name}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-violet-tint">
                  <div className="h-2.5 rounded-full bg-brand" style={{ width: `${(d.count / maxDept) * 100}%` }} />
                </div>
                <span className="w-6 text-right font-semibold tabular-nums">{d.count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Latest clock-ins today</h2>
            <Link to="/attendance" className="text-sm text-violet-text hover:underline">Open attendance</Link>
          </div>
          <ul className="divide-y divide-line">
            {data.recentClockIns.map((r) => (
              <li key={r.employeeId} className="flex items-center gap-3 py-3">
                <Avatar first={r.firstName} last={r.lastName} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{r.firstName} {r.lastName}</div>
                  <div className="text-xs text-muted">{r.department ?? 'No department'}</div>
                </div>
                <span className="text-sm tabular-nums text-body">{fmtTime(r.timeIn)}</span>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
          {data.recentClockIns.length === 0 && <p className="py-3 text-sm text-muted">No one has clocked in yet today.</p>}
        </Card>

        <Card className="p-6">
          <h2 className="mb-3 font-semibold">On leave today</h2>
          <ul className="divide-y divide-line">
            {data.onLeaveToday.map((l) => (
              <li key={l.employeeId} className="flex items-center gap-3 py-3">
                <Avatar first={l.firstName} last={l.lastName} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{l.firstName} {l.lastName}</div>
                  <div className="text-xs text-muted">{l.type} · back after {fmtDate(l.endDate)}</div>
                </div>
                <StatusBadge status="on_leave" />
              </li>
            ))}
          </ul>
          {data.onLeaveToday.length === 0 && <p className="py-3 text-sm text-muted">Everyone is in today.</p>}
        </Card>
      </div>
    </div>
  );
}