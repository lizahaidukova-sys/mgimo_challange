import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { REQUEST_STATUS_LABEL, type RequestStatus, type StaffRequestRow } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/ui/states';
import { statusVariant } from '@/components/SessionLight';
import { cn, formatDate } from '@/lib/utils';

const filters: { value: 'all' | RequestStatus; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'submitted', label: 'Новые' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'ready', label: 'Готовы' },
  { value: 'rejected', label: 'Отклонены' },
];

export default function StaffRequestsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'all';
  const [rows, setRows] = useState<StaffRequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const query = status === 'all' ? '' : `?status=${status}`;
    api
      .get<{ rows: StaffRequestRow[] }>(`/api/staff/requests${query}`)
      .then((data) => setRows(data.rows))
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold sm:text-2xl">Очередь заявок</h1>

      <div className="flex flex-wrap gap-1.5">
        {filters.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => {
              const next = new URLSearchParams(params);
              if (filter.value === 'all') next.delete('status');
              else next.set('status', filter.value);
              setParams(next);
            }}
            aria-pressed={status === filter.value}
            className={cn(
              'min-h-11 shrink-0 rounded-full border px-3 text-sm font-medium sm:min-h-9',
              status === filter.value
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]',
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {loading ? <SkeletonCard rows={5} /> : null}
      {error ? <ErrorState message={error} /> : null}

      {!loading && !error && rows ? (
        rows.length === 0 ? (
          <EmptyState
            title="Заявок в этом фильтре нет"
            description="Выберите другой статус или дождитесь новых заявок."
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id}>
                <Link to={`/staff/requests/${row.id}`} className="block">
                  <Card
                    className={cn(
                      'transition-colors hover:border-[var(--accent)]/40',
                      row.overdue && 'border-[var(--error)]/40',
                    )}
                  >
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            №{row.id} · {row.typeLabel}
                          </p>
                          <p className="mt-0.5 text-xs text-[var(--muted)]">
                            {row.studentName} · {row.studentGroup}
                          </p>
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            Срок: {formatDate(row.dueAt)}
                            {row.overdue ? (
                              <span className="ml-1 font-medium text-[var(--error)]">просрочено</span>
                            ) : null}
                          </p>
                        </div>
                        <Badge variant={statusVariant(row.status)}>
                          {REQUEST_STATUS_LABEL[row.status]}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
