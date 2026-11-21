import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock3, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { REQUEST_STATUS_LABEL, type RequestDetail } from '@shared/types';
import { requestFieldLabel } from '@shared/field-labels';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { statusVariant } from '@/components/SessionLight';
import { formatDate, formatDateTime } from '@/lib/utils';
import { AttachmentList } from '@/components/request/AttachmentList';

export default function RequestDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .get<RequestDetail>(`/api/requests/${id}`)
      .then(setData)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(reload, [reload]);

  return (
    <div className="space-y-4">
      <Link
        to="/requests"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]"
      >
        <ArrowLeft className="size-4" />
        К заявкам
      </Link>

      {loading ? <SkeletonCard rows={5} /> : null}
      {error ? (
        <ErrorState
          message={
            error === 'Не найдено'
              ? 'Заявка не найдена или принадлежит другому студенту.'
              : error
          }
        />
      ) : null}

      {!loading && !error && data ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold sm:text-2xl">{data.typeLabel}</h1>
              <p className="mt-0.5 text-sm text-[var(--muted)]">
                Заявка №{data.id} · подана {formatDate(data.createdAt)}
              </p>
            </div>
            <Badge variant={statusVariant(data.status)}>{data.statusLabel}</Badge>
          </div>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                <Clock3 className="mt-0.5 size-5 shrink-0 text-[var(--muted)]" />
                <div>
                  <p className="text-sm font-medium">
                    {data.status === 'ready'
                      ? 'Готово к получению'
                      : data.status === 'rejected'
                        ? 'Заявка отклонена'
                        : `Срок: ${formatDate(data.dueAt)}`}
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--muted)]">
                    {data.overdue
                      ? 'Срок прошёл. Уточните статус в деканате, если заявка не обновилась.'
                      : data.status === 'ready'
                        ? 'Заберите документ в деканате или по указанному в комментарии адресу.'
                        : 'Статус обновляется сотрудником деканата. Следить за ним можно здесь.'}
                  </p>
                </div>
              </div>
              {data.staffComment ? (
                <p className="mt-3 rounded-[8px] bg-[var(--bg)] p-3 text-sm">
                  <span className="font-medium">Комментарий деканата: </span>
                  {data.staffComment}
                </p>
              ) : null}
            </CardContent>
          </Card>

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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Документы</CardTitle>
            </CardHeader>
            <CardContent>
              <AttachmentList
                requestId={data.id}
                attachments={data.attachments}
                // К выполненной заявке досылать нечего: деканат её уже закрыл.
                canUpload={data.status !== 'ready'}
                onUploaded={reload}
              />
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
                    <span className="absolute -left-[5px] mt-1.5 size-2 rounded-full bg-[var(--accent)]" />
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

          {data.status === 'rejected' ? (
            <Link
              to="/requests/new"
              className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[var(--accent)]"
            >
              <Undo2 className="size-4" />
              Подать заново
            </Link>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
