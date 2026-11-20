import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Bell,
  CalendarDays,
  FileText,
  GraduationCap,
  Home,
  Inbox,
  LogOut,
  Megaphone,
  CalendarClock,
  UserRound,
} from 'lucide-react';
import { useAuth } from '@/App';
import { cn } from '@/lib/utils';

const studentNav = [
  { to: '/', label: 'Главная', icon: Home, end: true },
  { to: '/schedule', label: 'Расписание', icon: CalendarDays },
  { to: '/grades', label: 'Оценки', icon: GraduationCap },
  { to: '/requests', label: 'Заявки', icon: FileText },
];

const staffNav = [
  { to: '/staff', label: 'Сводка', icon: Home, end: true },
  { to: '/staff/requests', label: 'Заявки', icon: Inbox },
  { to: '/staff/schedule', label: 'Пары', icon: CalendarClock },
  { to: '/staff/announcements', label: 'Новости', icon: Megaphone },
];

export function AppShell() {
  const { user, unread, logout } = useAuth();
  const navigate = useNavigate();
  const nav = user.role === 'staff' ? staffNav : studentNav;

  return (
    <div className="min-h-dvh bg-[var(--bg)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <button
            type="button"
            onClick={() => navigate(user.role === 'staff' ? '/staff' : '/')}
            className="flex min-h-11 items-center gap-2 text-left"
            aria-label="На главную"
          >
            <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-[var(--accent)] text-sm font-semibold text-white">
              Д+
            </span>
            <span className="text-sm font-semibold">Деканат+</span>
          </button>

          <div className="flex items-center gap-1">
            {user.role === 'student' ? (
              <NavLink
                to="/notifications"
                className="relative grid h-11 w-11 place-items-center rounded-[8px] hover:bg-[var(--bg)]"
                aria-label={unread > 0 ? `Уведомления, непрочитанных: ${unread}` : 'Уведомления'}
              >
                <Bell className="size-5 text-[var(--muted)]" />
                {unread > 0 ? (
                  <span className="absolute right-1.5 top-1.5 grid min-w-[18px] place-items-center rounded-full bg-[var(--error)] px-1 text-[11px] font-semibold leading-4 text-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                ) : null}
              </NavLink>
            ) : null}
            <NavLink
              to="/profile"
              className="grid h-11 w-11 place-items-center rounded-[8px] hover:bg-[var(--bg)]"
              aria-label="Профиль"
            >
              <UserRound className="size-5 text-[var(--muted)]" />
            </NavLink>
            <button
              type="button"
              onClick={() => void logout()}
              className="grid h-11 w-11 place-items-center rounded-[8px] hover:bg-[var(--bg)]"
              aria-label="Выйти"
            >
              <LogOut className="size-5 text-[var(--muted)]" />
            </button>
          </div>
        </div>
      </header>

      <nav
        className="sticky top-14 z-20 hidden border-b border-[var(--border)] bg-[var(--surface)] md:block"
        aria-label="Разделы"
      >
        <ul className="mx-auto flex max-w-3xl gap-1 px-4">
          {nav.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium',
                    isActive
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]',
                  )
                }
              >
                <item.icon className="size-4" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <main className="app-main mx-auto max-w-3xl px-4 py-4">
        <Outlet />
        <footer className="mt-8 border-t border-[var(--border)] pt-4 text-xs leading-relaxed text-[var(--muted)]">
          Концепт для конкурса MGIMO AI Challenge. Не официальный сервис МГИМО. Все данные
          вымышленные.
        </footer>
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Основная навигация"
      >
        <ul className="mx-auto grid max-w-3xl grid-cols-4">
          {nav.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-[56px] flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium',
                    isActive ? 'text-[var(--accent)]' : 'text-[var(--muted)]',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon className={cn('size-5', isActive && 'stroke-[2.25]')} />
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

    </div>
  );
}
