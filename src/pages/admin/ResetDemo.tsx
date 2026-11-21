import { useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function AdminResetPage() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    if (
      !window.confirm(
        'Перезапустить демо-данные? Все правки, сделанные в админке, будут потеряны, заявки и расписание вернутся к исходным.',
      )
    ) {
      return;
    }
    setError(null);
    setPending(true);
    try {
      await api.post('/api/admin/reset-demo');
      toast.success('Демо-данные восстановлены');
      // Перезагрузка обязательна: сид пересоздал все id, старые ссылки мертвы.
      window.location.reload();
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'Не удалось перезапустить демо';
      setError(message);
      toast.error(message);
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold sm:text-2xl">Перезапуск демо</h1>

      <Card>
        <CardHeader>
          <CardTitle>Вернуть исходные данные</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-[var(--muted)]">
            Сид заново создаёт студентов, преподавателей, дисциплины, расписание, заявки и оценки.
            Всё, что вы правили в админке, будет удалено. Аккаунты и пароли останутся прежними,
            текущая сессия администратора сохранится.
          </p>
          {error ? (
            <p className="text-sm text-[var(--error)]" role="alert">
              {error}
            </p>
          ) : null}
          <Button variant="destructive" onClick={() => void reset()} disabled={pending}>
            {pending ? 'Перезапускаем…' : 'Перезапустить демо-данные'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
