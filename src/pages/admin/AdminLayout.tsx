import { Navigate, NavLink, Outlet } from 'react-router-dom';
import { CalendarDays, DoorOpen, GraduationCap, Layers, RotateCcw, Users, UserRound } from 'lucide-react';
import { useAuth } from '@/App';
import { cn } from '@/lib/utils';

// Раздел /admin доступен только роли admin: прячем и вкладки, и содержимое.
// Проверка на сервере всё равно главная — здесь она лишь не показывает пустой экран.

const adminTabs = [
  { to: '/admin/lessons', label: 'Пары', icon: CalendarDays },
  { to: '/admin/teachers', label: 'Преподаватели', icon: GraduationCap },
  { to: '/admin/rooms', label: 'Аудитории', icon: DoorOpen },
  { to: '/admin/courses', label: 'Дисциплины', icon: Layers },
  { to: '/admin/semesters', label: 'Семестры', icon: RotateCcw },
  { to: '/admin/people', label: 'Люди', icon: Users },
];

export function AdminLayout() {
  const { user } = useAuth();

  if (user.role !== 'admin') return <Navigate to="/staff" replace />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Не h1: единственный h1 страницы — заголовок сущности в AdminEntity. */}
        <p className="text-sm font-medium text-[var(--muted)]">Админка</p>
        <NavLink
          to="/admin/reset"
          className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-[var(--accent)]"
        >
          <UserRound className="size-4" />
          Перезапуск демо
        </NavLink>
      </div>

      <div className="-mx-4 overflow-x-auto border-b border-[var(--border)] px-4 md:mx-0 md:px-0">
        <ul className="flex gap-1.5 pb-2">
          {adminTabs.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-medium',
                    isActive
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'border-[var(--border)] text-[var(--muted)]',
                  )
                }
              >
                <tab.icon className="size-4 shrink-0" />
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>

      <Outlet />
    </div>
  );
}
