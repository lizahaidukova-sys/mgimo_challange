import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import type { SessionUser } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, Input, Label } from '@/components/ui/input';

interface DemoAccounts {
  accounts: { email: string; role: string; note: string }[];
  password: string;
}

export default function LoginPage({ onSuccess }: { onSuccess: (user: SessionUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [demo, setDemo] = useState<DemoAccounts | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get<DemoAccounts>('/api/demo-accounts')
      .then(setDemo)
      .catch(() => setDemo(null));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.post<{ ok: boolean; role: string }>('/api/login', { email, password });
      const user = await api.get<SessionUser>('/api/me');
      onSuccess(user);
      navigate(user.role === 'staff' ? '/staff' : '/', { replace: true });
    } catch (caught) {
      const message =
        caught instanceof ApiError ? caught.message : 'Не удалось войти. Повторите попытку.';
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  function useDemo(accountEmail: string) {
    setEmail(accountEmail);
    setPassword(demo?.password ?? 'demo12345');
    setError(null);
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-[var(--accent)] text-base font-semibold text-white">
          Д+
        </span>
        <div>
          <h1 className="text-xl font-semibold">Деканат+</h1>
          <p className="text-sm text-[var(--muted)]">Концепт для конкурса MGIMO AI Challenge</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Вход</CardTitle>
          <p className="text-sm text-[var(--muted)]">
            Демонстрационный кабинет. Не официальный сервис МГИМО.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate>
            <div className="mb-3">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={Boolean(error)}
                placeholder="student1@demo.local"
              />
            </div>
            <div className="mb-4">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={Boolean(error)}
              />
              <FieldError>{error}</FieldError>
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Входим…' : 'Войти'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {demo ? (
        <section className="mt-6" aria-labelledby="demo-title">
          <h2 id="demo-title" className="mb-2 text-sm font-medium text-[var(--muted)]">
            Тестовые аккаунты — пароль {demo.password}
          </h2>
          <ul className="space-y-2">
            {demo.accounts.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  onClick={() => useDemo(account.email)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-sm hover:bg-[var(--bg)]"
                >
                  <span>
                    <span className="block font-medium">{account.email}</span>
                    <span className="block text-[var(--muted)]">{account.note}</span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-[var(--accent)]">Подставить</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-6 text-xs leading-relaxed text-[var(--muted)]">
        Все ФИО, группы, оценки и заявки вымышлены. Кабинет не подключён к системам вуза.
      </p>
    </div>
  );
}
