import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { MessageRow } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { cn, formatDateTime } from '@/lib/utils';

export default function MessagesPage() {
  const [rows, setRows] = useState<MessageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<{ rows: MessageRow[] }>('/api/messages')
      .then((data) => setRows(data.rows))
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [rows]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (body.length < 2) {
      toast.error('Слишком короткое сообщение');
      return;
    }
    setPending(true);
    try {
      await api.post('/api/messages', { body });
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
      <h1 className="text-xl font-semibold sm:text-2xl">Сообщения</h1>
      <p className="text-sm text-[var(--muted)]">
        Переписка с деканатом. Ответ приходит сюда и в уведомления — со значком на колокольчике.
      </p>

      {loading ? <SkeletonCard rows={4} /> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}

      {!loading && !error && rows ? (
        <Card>
          <CardContent className="pt-4">
            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--muted)]">
                Переписки пока нет. Задайте вопрос — деканат ответит в рабочее время.
              </p>
            ) : (
              <ul className="space-y-3">
                {rows.map((message) => (
                  <li
                    key={message.id}
                    className={cn('flex', message.mine ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={cn(
                        'max-w-[85%] rounded-[12px] px-3 py-2 text-sm',
                        message.mine
                          ? 'bg-[var(--accent-soft)] text-[var(--fg)]'
                          : 'bg-[var(--bg)] text-[var(--fg)]',
                      )}
                    >
                      <p className="whitespace-pre-wrap">{message.body}</p>
                      <p className="mt-1 text-[11px] text-[var(--muted)]">
                        {message.mine ? 'Вы' : message.authorName} ·{' '}
                        {formatDateTime(message.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div ref={bottomRef} />
          </CardContent>
        </Card>
      ) : null}

      <form onSubmit={send} className="space-y-2">
        <label htmlFor="message" className="block text-sm font-medium">
          Новое сообщение
        </label>
        <Textarea
          id="message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Например: когда будет готова справка для стипендии?"
          maxLength={2000}
        />
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          <Send className="size-4" />
          {pending ? 'Отправляем…' : 'Отправить'}
        </Button>
      </form>
    </div>
  );
}
