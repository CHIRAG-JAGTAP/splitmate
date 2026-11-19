import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import AppShell from './layouts/AppShell';
import AuthLayout from './layouts/AuthLayout';
import Admin from './pages/Admin';
import Analytics from './pages/Analytics';
import { ForgotPassword, Login, Register, ResetPassword } from './pages/Auth';
import Budgets from './pages/Budgets';
import Dashboard from './pages/Dashboard';
import GroupDetail from './pages/GroupDetail';
import Groups from './pages/Groups';
import Notifications from './pages/Notifications';
import Profile from './pages/Profile';
import Settlements from './pages/Settlements';
import { useAuth } from './store';
import { EmptyState, PageSkeleton, Toaster } from './ui';
import { Link } from 'react-router-dom';

function Protected({ admin }: { admin?: boolean }) {
  const { user, ready } = useAuth(); const loc = useLocation();
  if (!ready) return <div className="p-8"><PageSkeleton /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}
function GuestOnly() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="p-8"><PageSkeleton /></div>;
  return user ? <Navigate to="/" replace /> : <Outlet />;
}
const NotFound = () => <div className="py-16"><EmptyState icon={<span className="text-2xl font-bold">404</span>} title="Page not found" body="That page does not exist." action={<Link className="font-semibold text-brand underline" to="/">Back to dashboard</Link>} /></div>;

export default function App() {
  const bootstrap = useAuth((s) => s.bootstrap);
  useEffect(() => { void bootstrap(); }, [bootstrap]);
  return (<>
    <Routes>
      <Route element={<GuestOnly />}><Route element={<AuthLayout />}>
        <Route path="/login" element={<Login />} /><Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} /><Route path="/reset-password" element={<ResetPassword />} />
      </Route></Route>
      <Route element={<Protected />}><Route element={<AppShell />}>
        <Route index element={<Dashboard />} /><Route path="groups" element={<Groups />} /><Route path="groups/:id" element={<GroupDetail />} />
        <Route path="settlements" element={<Settlements />} /><Route path="analytics" element={<Analytics />} /><Route path="budgets" element={<Budgets />} />
        <Route path="notifications" element={<Notifications />} /><Route path="profile" element={<Profile />} />
        <Route element={<Protected admin />}><Route path="admin" element={<Admin />} /><Route path="admin/reports" element={<Admin />} /></Route>
        <Route path="*" element={<NotFound />} />
      </Route></Route>
    </Routes>
    <Toaster />
  </>);
}
