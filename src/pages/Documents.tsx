import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Download, FileText, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import type { DocumentRow, PaymentRow } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/ui/states';
import { formatDate } from '@/lib/utils';

interface DocumentsResponse {
  documents: DocumentRow[];
  payments: PaymentRow[];
}

export default function DocumentsPage() {
  const [data, setData] = useState<DocumentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<DocumentsResponse>('/api/documents')
      .then(setData)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  if (loading) return <SkeletonCard rows={5} />;
  if (error || !data) return <ErrorState message={error ?? 'Ответ пустой'} onRetry={load} />;

  const totalPaid = data.payments
    .filter((payment) => payment.status === 'paid')
    .reduce((sum, payment) => sum + payment.amount, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold sm:text-2xl">Документы и выплаты</h1>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-4 text-[var(--muted)]" />
            Справки
          </CardTitle>
          <Link to="/requests/new" className="text-sm font-medium text-[var(--accent)]">
            Заказать
          </Link>
        </CardHeader>
        <CardContent>
          {data.documents.length === 0 ? (
            <EmptyState
              title="Справок пока нет"
              description="Заказанная справка появится здесь, как только деканат её выпустит."
              action={
                <Button asChild>
                  <Link to="/requests/new">Заказать справку</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.documents.map((document) => (
                <li key={document.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{document.kindLabel}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        №{document.number} · выдана {formatDate(document.issuedAt)}
                      </p>
                      {document.validUntil ? (
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          Действует до {formatDate(document.validUntil)}
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-xs text-[var(--muted)]">{document.issuedBy}</p>
                    </div>
                    <Button variant="secondary" onClick={() => downloadStub(document)}>
                      <Download className="size-4" />
                      Скачать
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-4 text-[var(--muted)]" />
            Стипендия
          </CardTitle>
          <span className="text-sm text-[var(--muted)]">
            всего {totalPaid.toLocaleString('ru-RU')} ₽
          </span>
        </CardHeader>
        <CardContent>
          {data.payments.length === 0 ? (
            <EmptyState title="Выплат пока нет" />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{payment.kindLabel}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {payment.period}
                      {payment.paidAt ? ` · ${formatDate(payment.paidAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium tabular-nums">
                      {payment.amount.toLocaleString('ru-RU')} ₽
                    </span>
                    <Badge variant={payment.status === 'paid' ? 'success' : 'warning'}>
                      {payment.status === 'paid' ? 'Выплачено' : 'Ожидается'}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start gap-3 pt-4">
          <CalendarClock className="mt-0.5 size-5 shrink-0 text-[var(--muted)]" />
          <div className="text-sm">
            <p className="font-medium">Справка не пришла вовремя?</p>
            <p className="mt-0.5 text-[var(--muted)]">
              Напишите в деканат — ответ придёт в раздел «Сообщения» и в уведомления.
            </p>
            <Button asChild variant="secondary" className="mt-3">
              <Link to="/messages">Написать в деканат</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Справка в прототипе не выдаётся реально: скачивается текстовый файл с реквизитами,
// чтобы было видно, что документ существует и его данные совпадают с кабинетом.
function downloadStub(document: DocumentRow): void {
  const content = [
    'КОНЦЕПТ ДЛЯ КОНКУРСА MGIMO AI CHALLENGE',
    'Не является официальным документом МГИМО.',
    '',
    document.kindLabel,
    `Номер: ${document.number}`,
    `Выдана: ${formatDate(document.issuedAt)}`,
    document.validUntil ? `Действует до: ${formatDate(document.validUntil)}` : '',
    `Кем выдана: ${document.issuedBy}`,
  ]
    .filter(Boolean)
    .join('\n');

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = `spravka-${document.number.replace(/[^\w-]+/g, '-')}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}
