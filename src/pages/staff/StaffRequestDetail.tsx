import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { REQUEST_STATUS_LABEL, type RequestStatus } from '@shared/types';
import type { RequestDetail } from '@shared/types';
import { requestFieldLabel } from '@shared/field-labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, Label, Textarea } from '@/components/ui/input';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { statusVariant } from '@/components/SessionLight';
import { cn, formatDate, formatDateTime } from '@/lib/utils';

type StaffDetail = RequestDetail & { studentName: string; studentGroup: string };

const nextStatuses: { value: RequestStatus; label: string; hint: string }[] = [
  { value: 'in_progress', label: 'Взять в работу', hint: 'Студент увидит, что заявка принята' },
  { value: 'ready', label: 'Готова', hint: 'Документ можно получить' },
  { value: 'rejected', label: 'Отклонить', hint: 'Причина обязательна и видна студенту' },
];

export default function StaffRequestDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState<StaffDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<RequestStatus | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<StaffDetail>(`/api/staff/requests/${id}`)
      .then(setData)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function apply(status: RequestStatus) {
    setFormError(null);
    if (status === 'rejected' && comment.trim().length < 5) {
      setFormError('Для отказа напишите причину — её увидит студент');
      return;
    }
    setPending(status);
    try {
      await api.post(`/api/staff/requests/${id}/status`, { status, comment });
      toast.success(`Статус: ${REQUEST_STATUS_LABEL[status].toLowerCase()}`);
      setComment('');
      load();
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'Не удалось изменить статус';
      setFormError(message);
      toast.error(message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <Link
        to="/staff/requests"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]"
      >
        <ArrowLeft className="size-4" />
        К очереди
      </Link>

      {loading ? <SkeletonCard rows={5} /> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}

      {!loading && !error && data ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold sm:text-2xl">
                №{data.id} · {data.typeLabel}
              </h1>
              <p className="mt-0.5 text-sm text-[var(--muted)]">
                {data.studentName} · {data.studentGroup} · подана {formatDate(data.createdAt)}
              </p>
            </div>
            <Badge variant={statusVariant(data.status)}>{data.statusLabel}</Badge>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Данные заявки</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                {Object.entries(data.payload).map(([key, value]) => (
                  <div key={key} className="flex flex-wrap justify-between gap-2">
                    <dt className="text-[var(--muted)]">{requestFieldLabel(key)}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-[var(--muted)]">
                Срок: {formatDate(data.dueAt)}
                {data.overdue ? ' · просрочено' : ''}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Действие</CardTitle>
            </CardHeader>
            <CardContent>
              <Label htmlFor="comment">Комментарий для студента</Label>
              <Textarea
                id="comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Например: готово, забрать в кабинете 214"
                maxLength={1000}
                aria-invalid={Boolean(formError)}
              />
              <FieldError>{formError}</FieldError>

              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                {nextStatuses.map((option) => (
                  <Button
                    key={option.value}
                    variant={option.value === 'rejected' ? 'destructive' : 'default'}
                    className="sm:flex-1"
                    disabled={pending !== null}
                    onClick={() => void apply(option.value)}
                  >
                    {option.value === 'ready' ? (
                      <CheckCircle2 className="size-4" />
                    ) : option.value === 'rejected' ? (
                      <XCircle className="size-4" />
                    ) : null}
                    {pending === option.value ? 'Сохраняем…' : option.label}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">
                {nextStatuses.find((option) => option.value === pending)?.hint ??
                  'Изменение сразу появится у студента в уведомлениях и в карточке заявки.'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>История</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="relative space-y-4 border-l border-[var(--border)] pl-4">
                {data.events.map((event) => (
                  <li key={event.id}>
                    <span
                      className={cn(
                        'absolute -left-[5px] mt-1.5 size-2 rounded-full',
                        event.status === 'rejected' ? 'bg-[var(--error)]' : 'bg-[var(--accent)]',
                      )}
                    />
                    <p className="text-sm font-medium">{REQUEST_STATUS_LABEL[event.status]}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {formatDateTime(event.createdAt)} · {event.actorName}
                    </p>
                    {event.comment ? (
                      <p className="mt-1 text-sm text-[var(--fg)]/85">{event.comment}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
