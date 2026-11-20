import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  FilePlus2,
  GraduationCap,
  MapPin,
  UserRound,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { DashboardData } from '@shared/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { Button } from '@/components/ui/button';
import { formatDate, formatTime, plural, relative } from '@/lib/utils';
import { SessionLight, statusVariant } from '@/components/SessionLight';

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<DashboardData>('/api/dashboard')
      .then(setData)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <SkeletonCard rows={3} />
        <SkeletonCard rows={4} />
        <SkeletonCard rows={2} />
      </div>
    );
  }

  if (error || !data) {
    return <ErrorState message={error ?? 'Ответ пустой'} onRetry={load} />;
  }

  const firstLesson = data.todayLessons.find((lesson) => lesson.status !== 'cancelled');
  const name = data.user.fullName.split(' ')[0] ?? data.user.fullName;

  return (
    <div className="space-y-4">
      <section>
        <h1 className="text-xl font-semibold sm:text-2xl">Привет, {name}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          {data.user.groupName} · {data.user.course} курс · {formatDate(new Date().toISOString())}
        </p>
      </section>

      <SessionLight state={data.sessionState} compact />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="size-4 text-[var(--muted)]" />
            Сегодня
          </CardTitle>
          <Link to="/schedule" className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--accent)]">
            Вся неделя
          </Link>
        </CardHeader>
        <CardContent>
          {data.todayLessons.length === 0 ? (
            <div className="rounded-[8px] bg-[var(--bg)] p-3">
              <p className="text-sm font-medium">На сегодня занятий нет</p>
              <p className="mt-0.5 text-sm text-[var(--muted)]">
                Ближайшее:{' '}
                {data.nextDeadline
                  ? `${data.nextDeadline.title}, ${formatDate(data.nextDeadline.at)}`
                  : 'в расписании пусто'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.todayLessons.map((lesson) => (
                <li key={lesson.id} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="w-14 shrink-0">
                    <p className="text-sm font-semibold tabular-nums">{formatTime(lesson.startsAt)}</p>
                    <p className="text-xs text-[var(--muted)] tabular-nums">{formatTime(lesson.endsAt)}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        lesson.status === 'cancelled'
                          ? 'text-sm font-medium line-through text-[var(--muted)]'
                          : 'text-sm font-medium'
                      }
                    >
                      {lesson.courseTitle}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" />
                        {lesson.roomName}, {lesson.building}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <UserRound className="size-3" />
                        {lesson.teacherName}
                      </span>
                    </p>
                    {lesson.status !== 'normal' ? (
                      <p className="mt-1.5">
                        <Badge variant={lesson.status === 'cancelled' ? 'error' : 'warning'}>
                          {lesson.status === 'cancelled' ? 'Отменено' : 'Перенесено'}
                          {lesson.previousStartsAt
                            ? ` с ${formatTime(lesson.previousStartsAt)}`
                            : ''}
                        </Badge>
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {firstLesson ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <Clock3 className="size-3.5" />
              Первая пара — {firstLesson.courseTitle} в {formatTime(firstLesson.startsAt)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Что изменилось</CardTitle>
          </CardHeader>
          <CardContent>
            {data.changes.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">С прошлого визита изменений нет.</p>
            ) : (
              <ul className="space-y-3">
                {data.changes.map((change) => (
                  <li key={change.id} className="text-sm">
                    <p className="font-medium">{change.title}</p>
                    <p className="text-[var(--muted)]">{change.body}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">{relative(change.at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Мои заявки</CardTitle>
            <Link to="/requests" className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--accent)]">
              Все
            </Link>
          </CardHeader>
          <CardContent>
            {data.activeRequests.length === 0 ? (
              <div className="rounded-[8px] bg-[var(--bg)] p-3">
                <p className="text-sm font-medium">Активных заявок нет</p>
                <p className="mt-0.5 text-sm text-[var(--muted)]">
                  Справку можно заказать за пару касаний.
                </p>
                <Button asChild size="sm" className="mt-3">
                  <Link to="/requests/new">
                    <FilePlus2 className="size-4" />
                    Создать заявку
                  </Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {data.activeRequests.map((request) => (
                  <li key={request.id} className="py-2.5 first:pt-0 last:pb-0">
                    <Link to={`/requests/${request.id}`} className="group flex min-h-11 flex-col justify-center">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium group-hover:text-[var(--accent)]">
                          {request.typeLabel}
                        </p>
                        <Badge variant={statusVariant(request.status)}>{request.statusLabel}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        №{request.id} · срок {formatDate(request.dueAt)}
                        {request.overdue ? ' · просрочено' : ''}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <GraduationCap className="size-4" />
            {data.sessionState.debts === 0
              ? 'Долгов нет'
              : `${data.sessionState.debts} ${plural(data.sessionState.debts, 'долг', 'долга', 'долгов')} по дисциплинам`}
          </div>
          <Link
            to="/grades"
            className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[var(--accent)]"
          >
            Успеваемость
            <ArrowRight className="size-4" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
