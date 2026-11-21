import { useNavigate } from 'react-router-dom';
import { LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/App';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const rows = [
    { label: 'ФИО', value: user.fullName },
    { label: 'E-mail', value: user.email },
    {
      label: 'Роль',
      value:
        user.role === 'admin'
          ? 'Администратор концепта'
          : user.role === 'staff'
            ? 'Сотрудник деканата'
            : 'Студент',
    },
    ...(user.role === 'student'
      ? [
          { label: 'Факультет', value: user.faculty },
          { label: 'Направление', value: user.program },
          { label: 'Курс', value: String(user.course) },
          { label: 'Группа', value: user.groupName },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold sm:text-2xl">Профиль</h1>

      <Card>
        <CardHeader>
          <CardTitle>{user.fullName}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-[var(--border)]">
            {rows.map((row) => (
              <div key={row.label} className="flex flex-wrap justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                <dt className="text-sm text-[var(--muted)]">{row.label}</dt>
                <dd className="text-sm font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start gap-3 pt-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[var(--success)]" />
          <div className="text-sm">
            <p className="font-medium">Данные защищены</p>
            <p className="mt-0.5 text-[var(--muted)]">
              Пароль хранится в виде хеша, сессия — в защищённой cookie. Другой студент не увидит
              ваши заявки, даже открыв прямую ссылку.
            </p>
          </div>
        </CardContent>
      </Card>

      <Button
        variant="secondary"
        className="w-full"
        onClick={() => {
          void logout();
          navigate('/login', { replace: true });
        }}
      >
        <LogOut className="size-4" />
        Выйти
      </Button>

      <p className="text-xs leading-relaxed text-[var(--muted)]">
        Профиль в концепте только для чтения: изменение данных студентом отключено, чтобы не
        имитировать процесс деканата. Концепт для конкурса, не официальный сервис МГИМО.
      </p>
    </div>
  );
}
