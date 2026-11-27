import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import {
  CalendarDays, Clock, LayoutGrid, LogOut, Menu, Sun, UserRound, Users, X, type LucideIcon, Banknote,
} from 'lucide-react';
import { api } from '../lib/api';
import { ROLE_LABEL, useAuth, type Role } from '../lib/auth';

const NAV: { to: string; label: string; icon: LucideIcon; roles: Role[] }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutGrid, roles: ['admin', 'finance', 'manager'] },
  { to: '/my-day', label: 'My day', icon: Sun, roles: ['employee', 'manager'] },
  { to: '/my-profile', label: 'My profile', icon: UserRound, roles: ['admin', 'finance', 'manager', 'employee'] },
  { to: '/employees', label: 'Employees', icon: Users, roles: ['admin', 'finance'] },
  { to: '/leave', label: 'Leave', icon: CalendarDays, roles: ['admin', 'finance', 'manager', 'employee'] },
  { to: '/attendance', label: 'Attendance', icon: Clock, roles: ['admin', 'finance', 'manager'] },
  { to: '/payroll', label: 'Payroll', icon: Banknote, roles: ['admin', 'finance'] },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [demo, setDemo] = useState(false);
  const [open, setOpen] = useState(false); // mobile menu

  useEffect(() => {
    api<{ demo: boolean }>('/config').then((d) => setDemo(d.demo)).catch(() => {});
  }, []);

  if (!user) return null;
  const items = NAV.filter((n) => n.roles.includes(user.role));

  const logo = (
    <div className="flex items-center gap-2.5">
      <img src="/logo.png" alt="" className="size-8" />
      <span className="font-display text-lg font-bold tracking-tight">ACIE</span>
    </div>
  );

  const navList = (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
              isActive ? 'bg-violet-tint font-semibold text-violet-text' : 'text-body hover:bg-paper'
            }`}>
          <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );

  const userBox = (
    <div className="border-t border-line px-3 pt-3 text-sm">
      <div className="truncate font-semibold">{user.email}</div>
      <div className="text-muted">{ROLE_LABEL[user.role]}</div>
      <button onClick={() => { setOpen(false); logout(); }}
        className="mt-2 flex items-center gap-2 text-muted hover:text-violet-text">
        <LogOut size={16} strokeWidth={1.8} aria-hidden="true" /> Log out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-white p-4 md:flex">
        <div className="px-2.5 pb-4">{logo}</div>
        {navList}
        <div className="flex-1" />
        {userBox}
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 border-b border-line bg-white md:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          {logo}
          <button type="button" onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}
            className="grid size-10 place-items-center rounded-lg text-body hover:bg-paper">
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
        {open && <div className="space-y-3 border-t border-line px-4 pb-4 pt-3">{navList}{userBox}</div>}
      </header>

      <main className="min-w-0 flex-1 p-4 sm:p-6 md:p-8">
        {demo && (
          <div role="note" className="mb-5 rounded-xl border border-violet-200 bg-violet-tint/60 px-4 py-2.5 text-sm text-violet-text">
            You're exploring a demo with sample data. Everything resets every night at 2 AM (Philippine time).
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}