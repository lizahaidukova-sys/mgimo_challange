import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import type { Lesson } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/ui/states';
import { cn, formatDate, formatTime, formatWeekday } from '@/lib/utils';

interface ScheduleResponse {
  view: 'day' | 'week';
  from: string;
  to: string;
  lessons: Lesson[];
}

function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export default function SchedulePage() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'week' ? 'week' : 'day';
  const date = params.get('date') ?? '';
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const query = useMemo(() => {
    const search = new URLSearchParams({ view });
    if (date) search.set('date', date);
    return search.toString();
  }, [view, date]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get<ScheduleResponse>(`/api/schedule?${query}`)
      .then(setData)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [query]);

  function setView(next: 'day' | 'week') {
    const nextParams = new URLSearchParams(params);
    nextParams.set('view', next);
    setParams(nextParams);
  }

  function shift(days: number) {
    const base = data ? new Date(data.from) : new Date();
    const next = new Date(base);
    next.setDate(next.getDate() + (view === 'week' ? days * 7 : days));
    const nextParams = new URLSearchParams(params);
    nextParams.set('date', next.toISOString());
    setParams(nextParams);
  }

  const grouped = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, Lesson[]>();
    for (const lesson of data.lessons) {
      const key = dayKey(lesson.startsAt);
      const list = map.get(key) ?? [];
      list.push(lesson);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Расписание</h1>
        <div className="flex rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-0.5">
          <button
            type="button"
            onClick={() => setView('day')}
            aria-pressed={view === 'day'}
            className={cn(
              'min-h-11 rounded-[6px] px-3 text-sm font-medium sm:min-h-9',
              view === 'day' ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--muted)]',
            )}
          >
            День
          </button>
          <button
            type="button"
            onClick={() => setView('week')}
            aria-pressed={view === 'week'}
            className={cn(
              'min-h-11 rounded-[6px] px-3 text-sm font-medium sm:min-h-9',
              view === 'week' ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--muted)]',
            )}
          >
            Неделя
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button variant="secondary" size="sm" onClick={() => shift(-1)} aria-label="Предыдущий период">
          <ChevronLeft className="size-4" />
        </Button>
        <p className="text-sm font-medium">
          {data
            ? view === 'week'
              ? `${formatDate(data.from)} — ${formatDate(new Date(new Date(data.to).getTime() - 1).toISOString())}`
              : formatWeekday(data.from) + ', ' + formatDate(data.from)
            : '…'}
        </p>
        <Button variant="secondary" size="sm" onClick={() => shift(1)} aria-label="Следующий период">
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {loading ? <SkeletonCard rows={6} /> : null}
      {error ? <ErrorState message={error} onRetry={() => setParams(new URLSearchParams(params))} /> : null}

      {!loading && !error && data ? (
        grouped.length === 0 ? (
          <EmptyState
            title={view === 'week' ? 'На этой неделе занятий нет' : 'На этот день занятий нет'}
            description="Выберите другой период или откройте неделю целиком."
            action={
              view === 'day' ? (
                <Button variant="secondary" onClick={() => setView('week')}>
                  <CalendarDays className="size-4" />
                  Показать неделю
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="space-y-4">
            {grouped.map(([key, lessons]) => (
              <section key={key} aria-label={formatWeekday(lessons[0].startsAt)}>
                <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
                  {formatWeekday(lessons[0].startsAt)}
                  <span className="text-xs font-normal text-[var(--muted)]">
                    {formatDate(lessons[0].startsAt)}
                  </span>
                </h2>
                <ul className="space-y-2">
                  {lessons.map((lesson) => (
                    <li key={lesson.id}>
                      <Card className={cn(lesson.status === 'cancelled' && 'opacity-80')}>
                        <CardContent className="pt-4">
                          <div className="flex gap-3">
                            <div className="w-16 shrink-0">
                              <p className="text-sm font-semibold tabular-nums">
                                {formatTime(lesson.startsAt)}
                              </p>
                              <p className="text-xs text-[var(--muted)] tabular-nums">
                                {formatTime(lesson.endsAt)}
                              </p>
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-start justify-between gap-1">
                                <p
                                  className={cn(
                                    'text-sm font-medium',
                                    lesson.status === 'cancelled' &&
                                      'line-through text-[var(--muted)]',
                                  )}
                                >
                                  {lesson.courseTitle}
                                </p>
                                <span className="text-xs text-[var(--muted)]">{lesson.kind}</span>
                              </div>
                              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
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
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <Badge variant={lesson.status === 'cancelled' ? 'error' : 'warning'}>
                                    {lesson.status === 'cancelled' ? 'Отменено' : 'Перенесено'}
                                  </Badge>
                                  {lesson.previousStartsAt ? (
                                    <span className="text-xs text-[var(--muted)]">
                                      было в {formatTime(lesson.previousStartsAt)}
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                              {lesson.note ? (
                                <p className="mt-1.5 text-xs text-[var(--muted)]">{lesson.note}</p>
                              ) : null}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
