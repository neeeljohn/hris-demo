import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Download, Plus, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { downloadCsv } from '../lib/csv';
import {
  Avatar, Card, EMPLOYMENT_LABEL, StatusBadge, btnPrimary, btnSecondary, fmtMonth, inputCls, statusLabel,
} from '../components/ui';


type Row = {
  id: string; employeeNo: string; firstName: string; lastName: string; email: string;
  employmentType: string; status: string; hireDate: string;
  department: string | null; position: string | null;
};
type Dept = { id: string; name: string };

export default function Employees() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ departments: Dept[] }>('/employees/meta').then((d) => setDepts(d.departments)).catch(() => {});
  }, []);

  const exportCsv = () => {
    if (!rows) return;
    downloadCsv(
      `employees-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Employee no.', 'First name', 'Last name', 'Email', 'Position', 'Department', 'Type', 'Status', 'Hire date'],
      rows.map((e) => [
        e.employeeNo, e.firstName, e.lastName, e.email, e.position, e.department,
        EMPLOYMENT_LABEL[e.employmentType], statusLabel(e.status), e.hireDate,
      ]),
    );
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (dept) params.set('dept', dept);
      api<{ employees: Row[] }>(`/employees?${params}`)
        .then((d) => { setRows(d.employees); setError(''); })
        .catch((e: Error) => setError(e.message));
    }, 250); // wait until typing pauses
    return () => clearTimeout(timer);
  }, [q, dept]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Employees</h1>
          <p className="mt-1 text-sm text-muted">
            {rows ? `${rows.length} ${rows.length === 1 ? 'employee' : 'employees'}` : 'Loading…'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportCsv} disabled={!rows?.length} className={`${btnSecondary} disabled:opacity-50`}>
            <Download size={16} aria-hidden="true" /> Export CSV
          </button>
          {user?.role === 'admin' && (
            <Link to="/employees/new" className={btnPrimary}>
              <Plus size={18} aria-hidden="true" /> Add employee
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex-[1_1_260px]">
          <span className="sr-only">Search employees</span>
          <Search size={18} aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email or position" className={`${inputCls} pl-10`} />
        </label>
        <div className="flex flex-wrap gap-2">
          {[{ id: '', name: 'All' }, ...depts].map((d) => (
            <button key={d.id || 'all'} type="button" onClick={() => setDept(d.id)}
              className={`h-9 rounded-full border px-3.5 text-sm font-medium ${
                dept === d.id
                  ? 'border-violet-300 bg-violet-tint text-violet-text'
                  : 'border-field bg-white text-body hover:border-violet-300'
              }`}>
              {d.name}
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-180 text-sm">
          <thead>
            <tr className="bg-paper text-left text-xs text-muted">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="font-medium">Position</th>
              <th className="font-medium">Department</th>
              <th className="font-medium">Type</th>
              <th className="font-medium">Hired</th>
              <th className="font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((e) => (
              <tr key={e.id} onClick={() => navigate(`/employees/${e.id}`)}
                className="cursor-pointer border-t border-line hover:bg-paper/60">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar first={e.firstName} last={e.lastName} />
                    <div>
                      <Link to={`/employees/${e.id}`} onClick={(ev) => ev.stopPropagation()}
                        className="font-medium hover:text-violet-text">
                        {e.firstName} {e.lastName}
                      </Link>
                      <div className="text-xs text-muted">{e.email}</div>
                    </div>
                  </div>
                </td>
                <td className="text-body">{e.position ?? '—'}</td>
                <td className="text-body">{e.department ?? '—'}</td>
                <td className="text-body">{EMPLOYMENT_LABEL[e.employmentType]}</td>
                <td className="text-body tabular-nums">{fmtMonth(e.hireDate)}</td>
                <td><StatusBadge status={e.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows?.length === 0 && <p className="p-8 text-center text-sm text-muted">No employees match your search.</p>}
      </Card>
    </div>
  );
}