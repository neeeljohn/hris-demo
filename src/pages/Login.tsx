import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth, homeFor, type Role } from '../lib/auth';

const DEMOS: { role: Role; label: string; hint: string }[] = [
  { role: 'admin', label: 'HR Admin', hint: 'Everything' },
  { role: 'finance', label: 'Finance', hint: 'Payroll and reports' },
  { role: 'manager', label: 'Manager', hint: 'Team approvals' },
  { role: 'employee', label: 'Employee', hint: 'Clock in, leave' },
];

const input =
  'mt-1.5 w-full h-11 rounded-[10px] border border-field bg-white px-3.5 text-[15px] outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100';

export default function Login() {
  const { user, login, demoLogin } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  async function run(action: () => Promise<Role>) {
    setError('');
    setBusy(true);
    try {
      const role = await action();
      navigate(homeFor(role), { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    run(() => login(email, password));
  }

  return (
    <div className="min-h-screen flex flex-wrap">
      <section className="bg-brand text-white flex-[1_1_420px] p-10 md:p-14 flex flex-col justify-between gap-12">
        <div className="flex items-center gap-2.5">
          <div className="size-11 rounded-xl bg-white grid place-items-center">
            <img src="/logo.png" alt="" className="size-8" />
            </div>
            <span className="font-display text-2xl font-bold tracking-tight">ACIE</span>
        </div>
        <div className="max-w-md space-y-4">
          <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight tracking-tight">
            Simple HR for small teams.
          </h1>
          <p className="text-violet-100 leading-relaxed">
            Employee records, leave and attendance in one place. Built for Philippine small businesses.
          </p>
        </div>
        <p className="text-sm text-violet-200">Demo data resets every night.</p>
      </section>

      <section className="flex-[1_1_480px] flex items-center justify-center px-6 py-14">
        <div className="w-full max-w-sm space-y-7">
          <div>
            <h2 className="font-display text-3xl font-semibold">Sign in</h2>
            <p className="mt-1.5 text-sm text-muted">Use your work email, or try a demo role below.</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block text-sm font-medium">
              Email
              <input type="email" autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className={input} />
            </label>
            <label className="block text-sm font-medium">
              Password
              <input type="password" autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={input} />
            </label>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <button disabled={busy}
              className="w-full h-11 rounded-[10px] bg-brand text-white text-sm font-semibold disabled:opacity-60">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted">
            <div className="flex-1 h-px bg-line" />Try the demo as<div className="flex-1 h-px bg-line" />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {DEMOS.map((d) => (
              <button key={d.role} type="button" disabled={busy}
                onClick={() => run(() => demoLogin(d.role))}
                className="text-left rounded-xl border border-line bg-white px-3.5 py-3 hover:border-violet-300 disabled:opacity-60">
                <span className="block text-sm font-semibold">{d.label}</span>
                <span className="block text-xs text-muted">{d.hint}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}