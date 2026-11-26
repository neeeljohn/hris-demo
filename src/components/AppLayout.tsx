import { NavLink, Outlet } from 'react-router';
import { LayoutGrid, Users, CalendarDays, Clock, Sun, LogOut, type LucideIcon } from 'lucide-react';
import { useAuth, ROLE_LABEL, type Role } from '../lib/auth';

const NAV: { to: string; label: string; icon: LucideIcon; roles: Role[] }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutGrid, roles: ['admin', 'finance', 'manager'] },
  { to: '/my-day', label: 'My day', icon: Sun, roles: ['employee', 'manager'] },
  { to: '/employees', label: 'Employees', icon: Users, roles: ['admin', 'finance'] },
  { to: '/leave', label: 'Leave', icon: CalendarDays, roles: ['admin', 'manager', 'employee'] },
  { to: '/attendance', label: 'Attendance', icon: Clock, roles: ['admin', 'finance', 'manager'] },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const items = NAV.filter((n) => n.roles.includes(user.role));

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="md:w-60 shrink-0 bg-white border-b md:border-b-0 md:border-r border-line p-4 flex flex-wrap md:flex-col md:flex-nowrap gap-1">
        <div className="flex items-center gap-2.5 px-2.5 pb-4 w-full">
           <img src="/logo.png" alt="" className="size-8" />
           <span className="font-display text-lg font-bold tracking-tight">ACIE</span>
        </div>

        {items.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm ${
                isActive ? 'bg-violet-tint text-violet-text font-semibold' : 'text-body hover:bg-paper'
              }`}>
            <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            {label}
          </NavLink>
        ))}

        <div className="hidden md:block flex-1" />

        <div className="md:border-t border-line md:pt-3 px-3 text-sm w-full">
          <div className="font-semibold truncate">{user.email}</div>
          <div className="text-muted">{ROLE_LABEL[user.role]}</div>
          <button onClick={logout}
            className="mt-2 flex items-center gap-2 text-muted hover:text-violet-text">
            <LogOut size={16} strokeWidth={1.8} aria-hidden="true" /> Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 p-6 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}