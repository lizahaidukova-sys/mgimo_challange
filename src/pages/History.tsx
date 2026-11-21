import { useEffect, useState } from 'react';
import { BookOpen, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import type { Semester, SemesterResult } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/ui/states';
import { cn, formatDate } from '@/lib/utils';

interface HistoryResponse {
  semesters: SemesterResult[];
  current: Semester[];
}

export default function HistoryPage() {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<HistoryResponse>('/api/grades/history')
      .then(setData)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <SkeletonCard rows={6} />;
  if (error || !data) return <ErrorState message={error ?? 'Ответ пустой'} />;

  const ordered = [...data.semesters].sort((a, b) => b.semester.number - a.semester.number);
  const allGraded = ordered.flatMap((result) => result.rows.filter((row) => row.grade !== null));
  const overallGpa =
    allGraded.length > 0
      ? Math.round(
          (allGraded.reduce((sum, row) => sum + (row.grade as number), 0) / allGraded.length) * 100,
        ) / 100
      : null;

  const creditsTotal = ordered.reduce((sum, result) => sum + result.credits, 0);
  const maxGpa = 5;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Зачётная книжка</h1>
        <div className="text-right">
          <p className="text-xs text-[var(--muted)]">Средний балл за всё время</p>
          <p className="text-2xl font-semibold tabular-nums">
            {overallGpa === null ? '—' : overallGpa.toFixed(2)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-[var(--muted)]">Семестров закрыто</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {ordered.filter((result) => !result.semester.isCurrent).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-[var(--muted)]">Зачётных единиц</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{creditsTotal}</p>
          </CardContent>
        </Card>
      </div>

      {data.semesters.length === 0 ? (
        <EmptyState
          title="Оценок пока нет"
          description="Зачётка заполнится после первой сессии."
        />
      ) : (
        <div className="space-y-3">
          {ordered.map((result, index) => {
            const previous = ordered[index + 1];
            const trend =
              result.gpa !== null && previous?.gpa != null ? result.gpa - previous.gpa : null;
            return (
              <Card key={result.semester.id}>
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    <BookOpen className="size-4 text-[var(--muted)]" />
                    {result.semester.title}
                    {result.semester.isCurrent ? <Badge variant="accent">Текущий</Badge> : null}
                  </CardTitle>
                  <span className="text-sm text-[var(--muted)]">
                    {formatDate(result.semester.startsOn)} — {formatDate(result.semester.endsOn)}
                  </span>
                </CardHeader>
                <CardContent>
                  <div className="mb-3 flex flex-wrap items-baseline gap-3">
                    <span className="text-sm">
                      Средний балл:{' '}
                      <span className="font-semibold tabular-nums">
                        {result.gpa === null ? '—' : result.gpa.toFixed(2)}
                      </span>
                    </span>
                    <span className="text-sm text-[var(--muted)]">
                      закрыто {result.passed} из {result.total}
                    </span>
                    {trend !== null ? (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-xs font-medium',
                          trend >= 0 ? 'text-[var(--success)]' : 'text-[var(--warning)]',
                        )}
                      >
                        {trend >= 0 ? (
                          <TrendingUp className="size-3.5" />
                        ) : (
                          <TrendingDown className="size-3.5" />
                        )}
                        {trend >= 0 ? '+' : ''}
                        {trend.toFixed(2)} к прошлому
                      </span>
                    ) : null}
                  </div>

                  <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)]"
                      style={{
                        width: `${
                          result.total === 0 ? 0 : Math.round((result.passed / result.total) * 100)
                        }%`,
                      }}
                    />
                  </div>

                  <ul className="divide-y divide-[var(--border)]">
                    {result.rows.map((row) => (
                      <li
                        key={row.enrollmentId}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm">{row.title}</p>
                          <p className="text-xs text-[var(--muted)]">
                            {row.teacherName} · {row.hours} ч ·{' '}
                            {row.controlForm === 'exam' ? 'экзамен' : 'зачёт'}
                          </p>
                        </div>
                        {row.grade !== null ? (
                          <span
                            className={cn(
                              'shrink-0 rounded-[6px] px-2 py-1 text-sm font-semibold tabular-nums',
                              row.grade >= 4
                                ? 'bg-[var(--success-soft)] text-[var(--success)]'
                                : row.grade === 3
                                  ? 'bg-[var(--warning-soft)] text-[var(--warning)]'
                                  : 'bg-[var(--error-soft)] text-[var(--error)]',
                            )}
                          >
                            {row.grade}
                          </span>
                        ) : (
                          <Badge
                            variant={
                              row.status === 'debt' || row.status === 'failed'
                                ? 'error'
                                : row.status === 'pending'
                                  ? 'neutral'
                                  : 'warning'
                            }
                          >
                            {row.status === 'debt' || row.status === 'failed'
                              ? 'долг'
                              : row.status === 'pending'
                                ? 'ожидает'
                                : 'не закрыта'}
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-[var(--muted)]">
        Средний балл считается по оценкам; незакрытые дисциплины в расчёт не входят.
        Диапазон оценок — от 2 до {maxGpa}.
      </p>
    </div>
  );
}
