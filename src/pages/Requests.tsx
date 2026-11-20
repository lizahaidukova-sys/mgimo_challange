import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus2, Inbox } from 'lucide-react';
import { api } from '@/lib/api';
import type { RequestRow } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/ui/states';
import { statusVariant } from '@/components/SessionLight';
import { formatDate } from '@/lib/utils';

export default function RequestsPage() {
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<{ rows: RequestRow[] }>('/api/requests')
      .then((data) => setRows(data.rows))
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Заявки</h1>
        <Button asChild size="sm">
          <Link to="/requests/new">
            <FilePlus2 className="size-4" />
            Новая
          </Link>
        </Button>
      </div>

      {loading ? <SkeletonCard rows={4} /> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}

      {!loading && !error && rows ? (
        rows.length === 0 ? (
          <EmptyState
            title="Пока нет заявок"
            description="Справку об обучении или заявление на пересдачу можно подать онлайн — без очереди в деканате."
            action={
              <Button asChild>
                <Link to="/requests/new">
                  <FilePlus2 className="size-4" />
                  Создать заявку
                </Link>
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((request) => (
              <li key={request.id}>
                <Link to={`/requests/${request.id}`} className="block">
                  <Card className="min-h-[44px] transition-colors hover:border-[var(--accent)]/40">
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{request.typeLabel}</p>
                          <p className="mt-0.5 text-xs text-[var(--muted)]">
                            №{request.id} · подана {formatDate(request.createdAt)}
                          </p>
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            Срок: {formatDate(request.dueAt)}
                            {request.overdue ? (
                              <span className="ml-1 font-medium text-[var(--error)]">просрочено</span>
                            ) : null}
                          </p>
                        </div>
                        <Badge variant={statusVariant(request.status)}>{request.statusLabel}</Badge>
                      </div>
                      {request.staffComment ? (
                        <p className="mt-2 flex items-start gap-1.5 rounded-[8px] bg-[var(--bg)] p-2 text-xs text-[var(--muted)]">
                          <Inbox className="mt-0.5 size-3.5 shrink-0" />
                          {request.staffComment}
                        </p>
                      ) : null}
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
