import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import { Card, btnPrimary, btnSecondary, inputCls } from '../components/ui';

type Meta = {
  departments: { id: string; name: string }[];
  positions: { id: string; title: string }[];
  managers: { id: string; firstName: string; lastName: string }[];
  shifts: { id: string; name: string }[];
};

const EMPTY = {
  firstName: '', lastName: '', email: '', phone: '',
  departmentId: '', positionId: '', managerId: '', shiftId: '',
  employmentType: 'regular', status: 'active',
  hireDate: new Date().toISOString().slice(0, 10),
  monthlyRate: '',
};
type Form = typeof EMPTY;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export default function EmployeeForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Meta>('/employees/meta').then(setMeta).catch((e: Error) => setError(e.message));
    if (id) {
      api<{ employee: Record<string, string | null> }>(`/employees/${id}`)
        .then(({ employee }) => {
          const v = (k: keyof Form) => employee[k] ?? '';
          setForm({
            firstName: v('firstName'), lastName: v('lastName'), email: v('email'), phone: v('phone'),
            departmentId: v('departmentId'), positionId: v('positionId'), managerId: v('managerId'),
            employmentType: v('employmentType'), status: v('status'), hireDate: v('hireDate'),
            shiftId: v('shiftId'),
            monthlyRate: employee.monthlyRate == null ? '' : String(employee.monthlyRate),
          });
        })
        .catch((e: Error) => setError(e.message));
    }
  }, [id]);

  const set = (k: keyof Form) => (ev: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: ev.target.value }));

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (editing) {
        await api(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(form) });
        navigate(`/employees/${id}`);
      } else {
        const d = await api<{ employee: { id: string } }>('/employees', {
          method: 'POST', body: JSON.stringify(form),
        });
        navigate(`/employees/${d.employee.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const backTo = editing ? `/employees/${id}` : '/employees';

  return (
    <div className="max-w-3xl space-y-5">
      <Link to={backTo} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-violet-text">
        <ArrowLeft size={16} aria-hidden="true" /> Back
      </Link>
      <h1 className="font-display text-3xl font-semibold tracking-tight">
        {editing ? 'Edit employee' : 'Add employee'}
      </h1>

      <Card className="p-6">
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name"><input required value={form.firstName} onChange={set('firstName')} className={inputCls} /></Field>
            <Field label="Last name"><input required value={form.lastName} onChange={set('lastName')} className={inputCls} /></Field>
            <Field label="Work email"><input required type="email" value={form.email} onChange={set('email')} placeholder="name@company.com" className={inputCls} /></Field>
            <Field label="Phone"><input value={form.phone} onChange={set('phone')} placeholder="09171234567" className={inputCls} /></Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Department">
              <select value={form.departmentId} onChange={set('departmentId')} className={inputCls}>
                <option value="">No department</option>
                {meta?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Position">
              <select value={form.positionId} onChange={set('positionId')} className={inputCls}>
                <option value="">No position</option>
                {meta?.positions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </Field>
            <Field label="Manager">
              <select value={form.managerId} onChange={set('managerId')} className={inputCls}>
                <option value="">No manager</option>
                {meta?.managers.filter((m) => m.id !== id).map((m) => (
                  <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
                ))}
              </select>
            </Field>
                        <Field label="Shift">
              <select value={form.shiftId} onChange={set('shiftId')} className={inputCls}>
                <option value="">Day (default)</option>
                {meta?.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Employment type">
              <select value={form.employmentType} onChange={set('employmentType')} className={inputCls}>
                <option value="regular">Regular</option>
                <option value="probationary">Probationary</option>
                <option value="contractual">Contractual</option>
              </select>
            </Field>
            <Field label="Hire date">
              <input required type="date" value={form.hireDate} onChange={set('hireDate')} className={inputCls} />
            </Field>
            <Field label="Monthly basic rate (PHP)">
              <input type="number" min="0" step="0.01" value={form.monthlyRate} onChange={set('monthlyRate')}
                placeholder="20000" className={inputCls} />
            </Field>
            {editing && (
              <Field label="Status">
                <select value={form.status} onChange={set('status')} className={inputCls}>
                  <option value="active">Active</option>
                  <option value="on_leave">On leave</option>
                  <option value="resigned">Resigned</option>
                </select>
              </Field>
            )}
          </div>

          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

          <div className="flex justify-end gap-3">
            <Link to={backTo} className={btnSecondary}>Cancel</Link>
            <button disabled={busy} className={btnPrimary}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add employee'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}