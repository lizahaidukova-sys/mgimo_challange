import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { MessageSquare, Send } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { DeanMessage } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/ui/states';
import { cn, formatDateTime } from '@/lib/utils';

interface Dialog {
  userId: number;
  studentName: string;
  studentGroup: string;
  messages: DeanMessage[];
  unread: number;
  lastAt: string;
}

export default function StaffDialogsPage() {
  const [rows, setRows] = useState<DeanMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<{ rows: DeanMessage[] }>('/api/staff/dialogs')
      .then((data) => setRows(data.rows))
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  // Группировка плоского списка в диалоги по студенту.
  const dialogs = useMemo<Dialog[]>(() => {
    if (!rows) return [];
    const map = new Map<number, Dialog>();
    for (const row of rows) {
      const dialog = map.get(row.userId) ?? {
        userId: row.userId,
        studentName: row.studentName,
        studentGroup: row.studentGroup,
        messages: [],
        unread: 0,
        lastAt: row.createdAt,
      };
      dialog.messages.push(row);
      if (!row.mine && row.readAt === null) dialog.unread += 1;
      if (row.createdAt > dialog.lastAt) dialog.lastAt = row.createdAt;
      map.set(row.userId, dialog);
    }
    return [...map.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  }, [rows]);

  const active = dialogs.find((dialog) => dialog.userId === activeId) ?? dialogs[0] ?? null;

  async function openDialog(dialog: Dialog) {
    setActiveId(dialog.userId);
    if (dialog.unread === 0) return;
    try {
      await api.post(`/api/staff/dialogs/${dialog.userId}/read`);
      load();
    } catch {
      // отметка о прочтении не критична для работы
    }
  }

  async function reply(event: React.FormEvent) {
    event.preventDefault();
    if (!active) return;
    const body = draft.trim();
    if (body.length < 2) {
      toast.error('Слишком короткий ответ');
      return;
    }
    setPending(true);
    try {
      await api.post(`/api/staff/dialogs/${active.userId}/reply`, { body });
      setDraft('');
      load();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Не удалось отправить');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold sm:text-2xl">Сообщения студентов</h1>

      {loading ? <SkeletonCard rows={5} /> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}

      {!loading && !error && dialogs.length === 0 ? (
        <EmptyState
          title="Сообщений нет"
          description="Студенты пишут сюда из кабинета — ответ появится у них в уведомлениях."
        />
      ) : null}

      {!loading && !error && dialogs.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-[240px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="size-4 text-[var(--muted)]" />
                Диалоги
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              <ul>
                {dialogs.map((dialog) => (
                  <li key={dialog.userId}>
                    <button
                      type="button"
                      onClick={() => void openDialog(dialog)}
                      className={cn(
                        'flex min-h-11 w-full items-center justify-between gap-2 rounded-[8px] px-2 py-2 text-left text-sm',
                        active?.userId === dialog.userId
                          ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                          : 'hover:bg-[var(--bg)]',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{dialog.studentName}</span>
                        <span className="block text-xs text-[var(--muted)]">
                          {dialog.studentGroup}
                        </span>
                      </span>
                      {dialog.unread > 0 ? (
                        <span className="shrink-0 rounded-full bg-[var(--error)] px-1.5 text-[11px] text-white">
                          {dialog.unread}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {active ? (
            <Card>
              <CardHeader>
                <CardTitle>{active.studentName}</CardTitle>
                <p className="text-xs text-[var(--muted)]">
                  {active.studentGroup} · {active.messages.length} сообщений
                </p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {active.messages.map((message) => (
                    <li
                      key={message.id}
                      className={cn('flex', message.mine ? 'justify-end' : 'justify-start')}
                    >
                      <div
                        className={cn(
                          'max-w-[85%] rounded-[12px] px-3 py-2 text-sm',
                          message.mine
                            ? 'bg-[var(--accent-soft)]'
                            : 'bg-[var(--bg)]',
                        )}
                      >
                        <p className="whitespace-pre-wrap">{message.body}</p>
                        <p className="mt-1 text-[11px] text-[var(--muted)]">
                          {message.mine ? 'Деканат' : active.studentName} ·{' '}
                          {formatDateTime(message.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>

                <form onSubmit={reply} className="mt-4 space-y-2">
                  <label htmlFor="reply" className="block text-sm font-medium">
                    Ответ
                  </label>
                  <Textarea
                    id="reply"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Например: справка готова, забрать в 214"
                    maxLength={2000}
                  />
                  <Button type="submit" disabled={pending}>
                    <Send className="size-4" />
                    {pending ? 'Отправляем…' : 'Отправить'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {!loading && dialogs.length > 0 ? (
        <p className="text-xs text-[var(--muted)]">
          Ответ уходит студенту в раздел «Сообщения» и в уведомления.{' '}
          <Badge variant="neutral">только вымышленные данные</Badge>
        </p>
      ) : null}
    </div>
  );
}
