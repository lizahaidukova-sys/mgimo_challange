import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';

import { api } from '@/lib/api';
import type { GradeRow, SessionState } from '@shared/types';
import { Badge } from '@/components/ui/badge';

import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/ui/states';
import { SessionLight } from '@/components/SessionLight';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDate } from '@/lib/utils';

interface GradesResponse {
  rows: GradeRow[];
  state: SessionState;
}

const statusLabel: Record<GradeRow['status'], { label: string; variant: 'success' | 'neutral' | 'warning' | 'error' }> = {
  passed: { label: 'Зачтено', variant: 'success' },
  pending: { label: 'В процессе', variant: 'neutral' },
  debt: { label: 'Долг', variant: 'warning' },
  failed: { label: 'Не сдано', variant: 'error' },
};

export default function GradesPage() {
  const [data, setData] = useState<GradesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<GradesResponse>('/api/grades')
      .then(setData)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <SkeletonCard rows={3} />
        <SkeletonCard rows={5} />
      </div>
    );
  }

  if (error || !data) {
    return <ErrorState message={error ?? 'Ответ пустой'} onRetry={load} />;
  }

  const graded = data.rows.filter((row) => row.grade !== null);
  const debts = data.rows.filter((row) => row.status === 'debt' || row.status === 'failed');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Успеваемость</h1>
        <Link to="/history" className="min-h-11 text-sm font-medium text-[var(--accent)]">
          <span className="inline-flex min-h-11 items-center gap-1">
            <BookOpen className="size-4" />
            Зачётная книжка
          </span>
        </Link>
      </div>

      <SessionLight state={data.state} />

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-[var(--muted)]">Средний балл</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {data.state.gpa === null ? '—' : data.state.gpa.toFixed(2)}
            </p>
            <p className="text-xs text-[var(--muted)]">по {graded.length} оценкам</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-[var(--muted)]">Долги</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{debts.length}</p>
            <p className="text-xs text-[var(--muted)]">
              {data.state.overdue > 0
                ? `${data.state.overdue} просрочено`
                : debts.length > 0
                  ? 'все в срок'
                  : 'нет'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">Все дисциплины</TabsTrigger>
          <TabsTrigger value="debts">Долги ({debts.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <GradeList rows={data.rows} />
        </TabsContent>
        <TabsContent value="debts">
          {debts.length === 0 ? (
            <EmptyState title="Долгов нет" description="Все дисциплины закрыты." />
          ) : (
            <GradeList rows={debts} />
          )}
        </TabsContent>
      </Tabs>

      <p className="text-xs leading-relaxed text-[var(--muted)]">
        Светофор считает правила, а не языковая модель: статус и приоритет воспроизводимы.
        Зачётная книжка в прототипе не подключена к системам вуза.
      </p>
    </div>
  );
}

function GradeList({ rows }: { rows: GradeRow[] }) {
  if (rows.length === 0) {
    return <EmptyState title="Пока нет оценок" description="Дисциплины появятся после начала семестра." />;
  }
  return (
    <ul className="mt-3 space-y-2">
      {rows.map((row) => {
        const meta = statusLabel[row.status];
        return (
          <li key={row.enrollmentId}>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{row.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {row.teacherName} · {row.controlForm === 'exam' ? 'экзамен' : 'зачёт'} ·{' '}
                      {row.credits} з.е.
                    </p>
                    {row.grade !== null ? (
                      <p className="mt-1 text-sm">
                        <span className="font-semibold">{row.grade}</span>{' '}
                        <span className="text-[var(--muted)]">{row.gradeLabel}</span>
                      </p>
                    ) : null}
                    {row.debtDeadline ? (
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Закрыть до {formatDate(row.debtDeadline)}
                      </p>
                    ) : null}
                    {row.retakeCount > 0 ? (
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {row.status === 'passed'
                          ? `Пересдач по дисциплине: ${row.retakeCount}`
                          : `Использовано пересдач: ${row.retakeCount}`}
                      </p>
                    ) : null}
                  </div>
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                </div>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
