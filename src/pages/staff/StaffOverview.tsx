import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Clock3, Inbox, Megaphone } from 'lucide-react';
import { api } from '@/lib/api';
import type { StaffOverview } from '@shared/types';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { formatDateTime } from '@/lib/utils';

export default function StaffOverviewPage() {
  const [data, setData] = useState<StaffOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<StaffOverview>('/api/staff/overview')
      .then(setData)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  if (loading) return <SkeletonCard rows={4} />;
  if (error || !data) return <ErrorState message={error ?? 'Ответ пустой'} onRetry={load} />;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold sm:text-2xl">Деканат</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-[var(--muted)]">Всего заявок</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{data.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-[var(--muted)]">Новые</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{data.byStatus.submitted}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-[var(--muted)]">В работе</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{data.byStatus.in_progress}</p>
          </CardContent>
        </Card>
        <Card className={data.overdue > 0 ? 'border-[var(--error)]/40' : undefined}>
          <CardContent className="pt-4">
            <p className="text-xs text-[var(--muted)]">Просрочено</p>
            <p
              className={
                data.overdue > 0
                  ? 'mt-1 text-2xl font-semibold tabular-nums text-[var(--error)]'
                  : 'mt-1 text-2xl font-semibold tabular-nums'
              }
            >
              {data.overdue}
            </p>
          </CardContent>
        </Card>
      </div>

      {data.overdue > 0 ? (
        <Card className="border-[var(--error)]/30 bg-[var(--error-soft)]">
          <CardContent className="flex items-start gap-3 pt-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--error)]" />
            <div className="text-sm">
              <p className="font-medium">Есть просроченные заявки</p>
              <p className="mt-0.5 text-[var(--fg)]/80">
                Срок истёк у {data.overdue}. Студенты видят это в кабинете — лучше закрыть сегодня.
              </p>
              <Button asChild size="sm" className="mt-3">
                <Link to="/staff/requests?status=submitted">Открыть очередь</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="size-4 text-[var(--muted)]" />
              Очередь заявок
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--muted)]">Старейшая новая</span>
              <span className="font-medium">
                {data.oldestSubmittedAt ? formatDateTime(data.oldestSubmittedAt) : 'нет'}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Сортировка по обещанному сроку: сначала те, кто рискует просрочкой.
            </p>
            <Link
              to="/staff/requests"
              className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[var(--accent)]"
            >
              К заявкам
              <ArrowRight className="size-4" />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="size-4 text-[var(--muted)]" />
              Объявления
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--muted)]">
              Объявление уходит в уведомления выбранной аудитории. Каждому студенту — одно, без
              дублей.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link to="/staff/announcements">Опубликовать</Link>
              </Button>
              <Button asChild size="sm" variant="secondary">
                <Link to="/staff/schedule">
                  <Clock3 className="size-4" />
                  Изменить пару
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs leading-relaxed text-[var(--muted)]">
        Кабинет сотрудника показывает очередь и обязательства, а не список всех студентов.
        Просмотр оценок студентов в концепт не включён. Концепт для конкурса, не официальный сервис
        МГИМО.
      </p>
    </div>
  );
}
