import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { api, ApiError } from '@/lib/api';
import type { SessionUser } from '@shared/types';
import { AppShell } from '@/components/layout/AppShell';
import LoginPage from '@/pages/Login';
import DashboardPage from '@/pages/Dashboard';
import SchedulePage from '@/pages/Schedule';
import GradesPage from '@/pages/Grades';
import RequestsPage from '@/pages/Requests';
import NewRequestPage from '@/pages/NewRequest';
import RequestDetailPage from '@/pages/RequestDetail';
import NotificationsPage from '@/pages/Notifications';
import ProfilePage from '@/pages/Profile';
import StaffOverviewPage from '@/pages/staff/StaffOverview';
import StaffRequestsPage from '@/pages/staff/StaffRequests';
import StaffRequestDetailPage from '@/pages/staff/StaffRequestDetail';
import StaffAnnouncementsPage from '@/pages/staff/StaffAnnouncements';
import StaffSchedulePage from '@/pages/staff/StaffSchedule';
import { SkeletonCard } from '@/components/ui/states';

interface AuthContextValue {
  user: SessionUser;
  unread: number;
  refreshUnread: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth вне AuthProvider');
  return value;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'ready'; user: SessionUser };

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const [unread, setUnread] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    api
      .get<SessionUser>('/api/me')
      .then((user) => {
        if (!cancelled) setAuth({ status: 'ready', user });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) setAuth({ status: 'anonymous' });
        else setAuth({ status: 'anonymous' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshUnread = useCallback(async () => {
    try {
      const data = await api.get<{ unread: number }>('/api/notifications');
      setUnread(data.unread);
    } catch {
      setUnread(0);
    }
  }, []);

  useEffect(() => {
    if (auth.status !== 'ready') return;
    void refreshUnread();
  }, [auth.status, location.pathname, refreshUnread]);

  const logout = useCallback(async () => {
    await api.post('/api/logout');
    setAuth({ status: 'anonymous' });
    navigate('/login', { replace: true });
  }, [navigate]);

  const contextValue = useMemo<AuthContextValue | null>(() => {
    if (auth.status !== 'ready') return null;
    return { user: auth.user, unread, refreshUnread, logout };
  }, [auth, unread, refreshUnread, logout]);

  if (auth.status === 'loading') {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <SkeletonCard rows={4} />
      </div>
    );
  }

  if (auth.status === 'anonymous') {
    if (location.pathname !== '/login') return <Navigate to="/login" replace />;
    return (
      <>
        <LoginPage onSuccess={(user) => setAuth({ status: 'ready', user })} />
        <Toaster position="top-center" richColors closeButton />
      </>
    );
  }

  return (
    <AuthContext.Provider value={contextValue!}>
      <Routes>
        <Route element={<AppShell />}>
          {auth.user.role === 'staff' ? (
            <>
              <Route path="/" element={<Navigate to="/staff" replace />} />
              <Route path="/staff" element={<StaffOverviewPage />} />
              <Route path="/staff/requests" element={<StaffRequestsPage />} />
              <Route path="/staff/requests/:id" element={<StaffRequestDetailPage />} />
              <Route path="/staff/announcements" element={<StaffAnnouncementsPage />} />
              <Route path="/staff/schedule" element={<StaffSchedulePage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="*" element={<Navigate to="/staff" replace />} />
            </>
          ) : (
            <>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/schedule" element={<SchedulePage />} />
              <Route path="/grades" element={<GradesPage />} />
              <Route path="/requests" element={<RequestsPage />} />
              <Route path="/requests/new" element={<NewRequestPage />} />
              <Route path="/requests/:id" element={<RequestDetailPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Route>
      </Routes>
      <Toaster position="top-center" richColors closeButton />
    </AuthContext.Provider>
  );
}
