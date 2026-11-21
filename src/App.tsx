import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { api, ApiError, TransportError } from '@/lib/api';
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
import DocumentsPage from '@/pages/Documents';
import RetakesPage from '@/pages/Retakes';
import MessagesPage from '@/pages/Messages';
import HistoryPage from '@/pages/History';
import StaffDialogsPage from '@/pages/staff/StaffDialogs';
import StaffOverviewPage from '@/pages/staff/StaffOverview';
import StaffRequestsPage from '@/pages/staff/StaffRequests';
import StaffRequestDetailPage from '@/pages/staff/StaffRequestDetail';
import StaffAnnouncementsPage from '@/pages/staff/StaffAnnouncements';
import StaffSchedulePage from '@/pages/staff/StaffSchedule';
import { AdminLayout } from '@/pages/admin/AdminLayout';
import AdminLessonsPage from '@/pages/admin/Lessons';
import AdminTeachersPage from '@/pages/admin/Teachers';
import AdminRoomsPage from '@/pages/admin/Rooms';
import AdminCoursesPage from '@/pages/admin/Courses';
import AdminSemestersPage from '@/pages/admin/Semesters';
import AdminPeoplePage from '@/pages/admin/People';
import AdminResetPage from '@/pages/admin/ResetDemo';
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
  | { status: 'offline' }
  | { status: 'ready'; user: SessionUser };

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const [unread, setUnread] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();

  const [authAttempt, setAuthAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setAuth({ status: 'loading' });
    api
      .get<SessionUser>('/api/me')
      .then((user) => {
        if (!cancelled) setAuth({ status: 'ready', user });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // 401 — действительно нет сессии. Всё остальное (сеть, 5xx) — не повод
        // показывать форму входа: человек не «разлогинен», сервер недоступен.
        if (error instanceof ApiError && error.status === 401) {
          setAuth({ status: 'anonymous' });
          return;
        }
        setAuth({ status: 'offline' });
        if (error instanceof TransportError) console.warn(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [authAttempt]);

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

  if (auth.status === 'offline') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
        <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5 text-center">
          <h1 className="text-lg font-semibold">Сервер недоступен</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Кабинет не открылся: нет ответа от сервера. Это не выход из аккаунта — данные и сессия
            сохранены.
          </p>
          <button
            type="button"
            onClick={() => setAuthAttempt((attempt) => attempt + 1)}
            className="mt-4 h-11 w-full rounded-[8px] bg-[var(--accent)] px-4 text-sm font-medium text-white"
          >
            Повторить
          </button>
        </div>
      </div>
    );
  }

  if (auth.status === 'anonymous') {
    if (location.pathname !== '/login') return <Navigate to="/login" replace />;
    return (
      <>
        <LoginPage onSuccess={(user) => setAuth({ status: 'ready', user })} />
        <Toaster position="bottom-center" richColors closeButton />
      </>
    );
  }

  return (
    <AuthContext.Provider value={contextValue!}>
      <Routes>
        <Route element={<AppShell />}>
          {auth.user.role !== 'student' ? (
            <>
              <Route path="/" element={<Navigate to="/staff" replace />} />
              <Route path="/staff" element={<StaffOverviewPage />} />
              <Route path="/staff/requests" element={<StaffRequestsPage />} />
              <Route path="/staff/requests/:id" element={<StaffRequestDetailPage />} />
              <Route path="/staff/announcements" element={<StaffAnnouncementsPage />} />
              <Route path="/staff/schedule" element={<StaffSchedulePage />} />
              <Route path="/staff/dialogs" element={<StaffDialogsPage />} />
              {/* Колокольчик в шапке есть у всех ролей — маршрут нужен и деканату. */}
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="lessons" replace />} />
                <Route path="lessons" element={<AdminLessonsPage />} />
                <Route path="teachers" element={<AdminTeachersPage />} />
                <Route path="rooms" element={<AdminRoomsPage />} />
                <Route path="courses" element={<AdminCoursesPage />} />
                <Route path="semesters" element={<AdminSemestersPage />} />
                <Route path="people" element={<AdminPeoplePage />} />
              </Route>
              <Route path="/admin/reset" element={<AdminResetPage />} />
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
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/retakes" element={<RetakesPage />} />
              <Route path="/messages" element={<MessagesPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Route>
      </Routes>
      <Toaster position="bottom-center" richColors closeButton />
    </AuthContext.Provider>
  );
}
