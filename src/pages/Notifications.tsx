import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { BellOff, CheckCheck, FileText, Megaphone, CalendarClock, MessageSquare } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/App';
import type { NotificationRow } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/ui/states';
import { relative } from '@/lib/utils';

const kindMeta: Record<
  NotificationRow['kind'],
  { icon: typeof Megaphone; label: string; variant: 'accent' | 'neutral' | 'warning' }
> = {
  announcement: { icon: Megaphone, label: 'Объявление', variant: 'accent' },
  request_status: { icon: FileText, label: 'Заявка', variant: 'neutral' },
  schedule_change: { icon: CalendarClock, label: 'Расписание', variant: 'warning' },
  message: { icon: MessageSquare, label: 'Сообщение', variant: 'accent' },
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<{ rows: NotificationRow[]; unread: number }>('/api/notifications')
      .then((data) => {
        setRows(data.rows);
        setUnread(data.unread);
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function markRead(id: number) {
    try {
      const result = await api.post<{ unread: number }>(`/api/notifications/${id}/read`);
      setUnread(result.unread);
      setRows((current) =>
        current
          ? current.map((row) => (row.id === id ? { ...row, readAt: new Date().toISOString() } : row))
          : current,
      );
    } catch {
      toast.error('Не удалось отметить уведомление');
    }
  }

  async function markAll() {
    try {
      await api.post('/api/notifications/read-all');
      setUnread(0);
      setRows((current) =>
        current
          ? current.map((row) => ({ ...row, readAt: row.readAt ?? new Date().toISOString() }))
          : current,
      );
      toast.success('Все уведомления прочитаны');
    } catch {
      toast.error('Не удалось отметить уведомления');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">
          Уведомления
          {unread > 0 ? (
            <span className="ml-2 align-middle text-sm font-medium text-[var(--muted)]">
              {unread} новых
            </span>
          ) : null}
        </h1>
        {unread > 0 ? (
          <Button variant="secondary" size="sm" onClick={() => void markAll()}>
            <CheckCheck className="size-4" />
            Прочитать все
          </Button>
        ) : null}
      </div>

      {loading ? <SkeletonCard rows={5} /> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}

      {!loading && !error && rows ? (
        rows.length === 0 ? (
          <EmptyState
            title="Уведомлений пока нет"
            description="Здесь появятся объявления деканата, изменения расписания и статусы заявок."
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const meta = kindMeta[row.kind];
              const unreadRow = row.readAt === null;
              const body = (
                <Card
                  className={
                    unreadRow
                      ? 'border-[var(--accent)]/35 bg-[var(--accent-soft)]/40'
                      : undefined
                  }
                >
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <meta.icon className="mt-0.5 size-4 shrink-0 text-[var(--muted)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{row.title}</p>
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                          {unreadRow ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)]">
                              <span className="size-1.5 rounded-full bg-[var(--accent)]" />
                              новое
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-[var(--fg)]/85">{row.body}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{relative(row.createdAt)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );

              // Уведомление о сообщении ведёт туда, где на него можно ответить.
              const role = user.role;
              const linkTo =
                row.kind === 'request_status' && row.refId
                  ? `/requests/${row.refId}`
                  : row.kind === 'message'
                    ? role === 'student'
                      ? '/messages'
                      : '/staff/dialogs'
                    : null;

              return (
                <li key={row.id}>
                  {linkTo ? (
                    <Link to={linkTo} onClick={() => unreadRow && void markRead(row.id)}>
                      {body}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="block w-full text-left"
                      onClick={() => unreadRow && void markRead(row.id)}
                    >
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {!loading && rows && rows.length > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <BellOff className="size-3.5" />
          Push и почта не подключены: прототип не отправляет сообщения вне кабинета.
        </p>
      ) : null}
    </div>
  );
}
