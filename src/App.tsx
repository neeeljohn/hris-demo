import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router';
import { AuthProvider, useAuth, homeFor } from './lib/auth';
import Login from './pages/Login';
import Placeholder from './pages/Placeholder';
import AppLayout from './components/AppLayout';
import Employees from './pages/Employees';
import EmployeeProfile from './pages/EmployeeProfile';
import EmployeeForm from './pages/EmployeeForm';
import Leave from './pages/Leave';

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center text-sm text-muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<Placeholder title="Dashboard" step="Step 10" />} />
              <Route path="/employees" element={<Employees />} />
              <Route path="/employees/new" element={<EmployeeForm />} />
              <Route path="/employees/:id" element={<EmployeeProfile />} />
              <Route path="/employees/:id/edit" element={<EmployeeForm />} />
              <Route path="/leave" element={<Leave />} />
              <Route path="/attendance" element={<Placeholder title="Attendance" step="Step 8" />} />
              <Route path="/my-day" element={<Placeholder title="My day" step="Step 8" />} />
            </Route>
            <Route path="*" element={<Home />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}