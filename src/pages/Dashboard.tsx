import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  Clock3,
  FilePlus2,
  FileText,
  GraduationCap,
  MapPin,
  MessageSquare,
  UserRound,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { DashboardData } from '@shared/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { Button } from '@/components/ui/button';
import { formatDate, formatTime, plural, relative } from '@/lib/utils';
import { SessionLight, statusVariant } from '@/components/SessionLight';
import { cn } from '@/lib/utils';

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

  const name = data.user.fullName.split(' ')[0] ?? data.user.fullName;
  const progressPercent =
    data.progress.total === 0
      ? 0
      : Math.round((data.progress.passed / data.progress.total) * 100);
  const urgentDeadlines = data.todayDeadlines.filter((entry) => entry.urgent);

  return (
    <div className="space-y-4">
      <section>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold sm:text-2xl">Привет, {name}</h1>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              {data.user.groupName} · {data.user.course} курс ·{' '}
              {formatDate(new Date().toISOString())}
            </p>
          </div>
          {data.daysToSession > 0 ? (
            <div className="rounded-[8px] bg-[var(--surface)] px-3 py-1.5 text-right ring-1 ring-[var(--border)]">
              <p className="text-[11px] text-[var(--muted)]">до конца сессии</p>
              <p className="text-sm font-semibold tabular-nums">
                {data.daysToSession} {plural(data.daysToSession, 'день', 'дня', 'дней')}
              </p>
            </div>
          ) : null}
        </div>
      </section>

      {urgentDeadlines.length > 0 ? (
        <section
          className="rounded-[12px] border border-[var(--warning)]/30 bg-[var(--warning-soft)] p-4"
          aria-label="Срочные дедлайны"
        >
          <p className="text-sm font-semibold">Срочно</p>
          <ul className="mt-2 space-y-1.5">
            {urgentDeadlines.slice(0, 3).map((entry) => (
              <li key={`${entry.title}-${entry.at}`} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0">{entry.title}</span>
                <span className="shrink-0 text-xs font-medium text-[var(--warning)]">
                  {entry.detail}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4 text-[var(--muted)]" />
              Ближайшая пара
            </CardTitle>
            <Link
              to="/schedule"
              className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--accent)]"
            >
              Расписание
            </Link>
          </CardHeader>
          <CardContent>
            {data.nextLesson ? (
              <div>
                <p className="text-sm font-medium">{data.nextLesson.courseTitle}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="size-3" />
                    {formatDate(data.nextLesson.startsAt)},{' '}
                    {formatTime(data.nextLesson.startsAt)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" />
                    {data.nextLesson.roomName}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <UserRound className="size-3" />
                    {data.nextLesson.teacherName}
                  </span>
                </p>
                {data.nextLesson.status !== 'normal' ? (
                  <p className="mt-2">
                    <Badge variant={data.nextLesson.status === 'cancelled' ? 'error' : 'warning'}>
                      {data.nextLesson.status === 'cancelled' ? 'Отменено' : 'Перенесено'}
                    </Badge>
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                Ближайших пар нет. Проверьте расписание на следующую неделю.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="size-4 text-[var(--muted)]" />
              Семестр
            </CardTitle>
            <Link
              to="/history"
              className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--accent)]"
            >
              Зачётка
            </Link>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-[var(--muted)]">закрыто дисциплин</span>
              <span className="font-semibold tabular-nums">
                {data.progress.passed} из {data.progress.total}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full rounded-full bg-[var(--accent)]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              {data.progress.credits} из {data.progress.plannedCredits} зачётных единиц
            </p>
            {data.retakeSoon ? (
              <p className="mt-2 rounded-[8px] bg-[var(--bg)] p-2 text-xs">
                Пересдача: {data.retakeSoon.courseTitle},{' '}
                {formatDate(data.retakeSoon.startsAt)} в {formatTime(data.retakeSoon.startsAt)}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <SessionLight state={data.sessionState} compact />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-[var(--muted)]" />
            Сегодня
          </CardTitle>
          <Link
            to="/schedule"
            className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--accent)]"
          >
            Вся неделя
          </Link>
        </CardHeader>
        <CardContent>
          {data.todayLessons.length === 0 ? (
            <div className="rounded-[8px] bg-[var(--bg)] p-3">
              <p className="text-sm font-medium">На сегодня занятий нет</p>
              <p className="mt-0.5 text-sm text-[var(--muted)]">
                {data.nextLesson
                  ? `Ближайшее: ${data.nextLesson.courseTitle}, ${formatDate(data.nextLesson.startsAt)}`
                  : 'В расписании на неделю пусто'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.todayLessons.map((lesson) => (
                <li key={lesson.id} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="w-14 shrink-0">
                    <p className="text-sm font-semibold tabular-nums">
                      {formatTime(lesson.startsAt)}
                    </p>
                    <p className="text-xs text-[var(--muted)] tabular-nums">
                      {formatTime(lesson.endsAt)}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm font-medium',
                        lesson.status === 'cancelled' && 'line-through text-[var(--muted)]',
                      )}
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
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Что изменилось</CardTitle>
          </CardHeader>
          <CardContent>
            {data.changes.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">За последние три дня изменений нет.</p>
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
            <Link
              to="/requests"
              className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--accent)]"
            >
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
                    <Link
                      to={`/requests/${request.id}`}
                      className="group flex min-h-11 flex-col justify-center"
                    >
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

      <div className="grid gap-3 sm:grid-cols-3">
        <Link to="/documents" className="block">
          <Card className="h-full transition-colors hover:border-[var(--accent)]/40">
            <CardContent className="flex items-center gap-3 pt-4">
              <FileText className="size-5 shrink-0 text-[var(--muted)]" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Документы</p>
                <p className="text-xs text-[var(--muted)]">Справки и стипендия</p>
              </div>
              <ArrowRight className="ml-auto size-4 shrink-0 text-[var(--muted)]" />
            </CardContent>
          </Card>
        </Link>

        <Link to="/messages" className="block">
          <Card className="h-full transition-colors hover:border-[var(--accent)]/40">
            <CardContent className="flex items-center gap-3 pt-4">
              <MessageSquare className="size-5 shrink-0 text-[var(--muted)]" />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  Сообщения
                  {data.unreadMessages > 0 ? (
                    <span className="ml-1.5 rounded-full bg-[var(--error)] px-1.5 text-[11px] text-white">
                      {data.unreadMessages}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-[var(--muted)]">Связь с деканатом</p>
              </div>
              <ArrowRight className="ml-auto size-4 shrink-0 text-[var(--muted)]" />
            </CardContent>
          </Card>
        </Link>

        <Link to="/retakes" className="block">
          <Card className="h-full transition-colors hover:border-[var(--accent)]/40">
            <CardContent className="flex items-center gap-3 pt-4">
              <BookOpen className="size-5 shrink-0 text-[var(--muted)]" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Пересдачи</p>
                <p className="text-xs text-[var(--muted)]">
                  {data.sessionState.debts > 0
                    ? `${data.sessionState.debts} ${plural(data.sessionState.debts, 'долг', 'долга', 'долгов')}`
                    : 'Записей нет'}
                </p>
              </div>
              <ArrowRight className="ml-auto size-4 shrink-0 text-[var(--muted)]" />
            </CardContent>
          </Card>
        </Link>
      </div>

      {data.scholarship ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
            <div className="flex items-center gap-2 text-sm">
              <Wallet className="size-4 text-[var(--muted)]" />
              <span className="text-[var(--muted)]">Стипендия за {data.scholarship.period}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tabular-nums">
                {data.scholarship.amount.toLocaleString('ru-RU')} ₽
              </span>
              <Badge variant={data.scholarship.paid ? 'success' : 'warning'}>
                {data.scholarship.paid ? 'Выплачено' : 'Ожидается'}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
