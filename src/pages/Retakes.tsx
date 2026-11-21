import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock, MapPin, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { RetakeSlot } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/ui/states';
import { formatDate, formatTime } from '@/lib/utils';

export default function RetakesPage() {
  const [rows, setRows] = useState<RetakeSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<number | null>(null);
  // Слот, для которого открыт диалог подтверждения. Запись без диалога
  // непонятна: человек не видит ни даты, ни аудитории, ни последствий.
  const [confirming, setConfirming] = useState<RetakeSlot | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<{ rows: RetakeSlot[] }>('/api/retakes')
      .then((data) => setRows(data.rows))
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function book(slot: RetakeSlot) {
    setPending(slot.id);
    try {
      await api.post(`/api/retakes/${slot.id}/book`);
      toast.success('Запись подтверждена');
      setConfirming(null);
      load();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Не удалось записаться');
    } finally {
      setPending(null);
    }
  }

  async function cancel(slot: RetakeSlot) {
    setPending(slot.id);
    try {
      await api.post(`/api/retakes/${slot.id}/cancel`);
      toast.success('Запись отменена');
      load();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Не удалось отменить');
    } finally {
      setPending(null);
    }
  }

  const mine = rows?.filter((slot) => slot.myBookingId !== null) ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold sm:text-2xl">Пересдачи</h1>
      <p className="text-sm text-[var(--muted)]">
        Здесь только дисциплины, которые нужно пересдать: долг, «не сдано» или уже начатая
        пересдача. Сданные дисциплины в список не попадают. Запись открыта за день до пересдачи.
        Если мест не осталось — напишите в деканат.
      </p>

      {loading ? <SkeletonCard rows={4} /> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}

      {!loading && !error && rows ? (
        rows.length === 0 ? (
          <EmptyState
            title="Пересдавать нечего"
            description="Все дисциплины закрыты. Если появятся долги, слоты пересдач придут сюда."
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((slot) => {
              const full = slot.booked >= slot.capacity;
              const booked = slot.myBookingId !== null;
              return (
                <li key={slot.id}>
                  <Card className={booked ? 'border-[var(--accent)]/40' : undefined}>
                    <CardContent className="pt-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium">{slot.courseTitle}</p>
                            {booked ? <Badge variant="accent">Вы записаны</Badge> : null}
                            {full && !booked ? <Badge variant="warning">Мест нет</Badge> : null}
                          </div>
                          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                            <span className="inline-flex items-center gap-1">
                              <CalendarClock className="size-3" />
                              {formatDate(slot.startsAt)}, {formatTime(slot.startsAt)}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="size-3" />
                              {slot.roomName}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Users className="size-3" />
                              {slot.booked} из {slot.capacity}
                            </span>
                          </p>
                          <p className="mt-1 text-xs text-[var(--muted)]">{slot.teacherName}</p>
                          {slot.comment ? (
                            <p className="mt-1 text-xs text-[var(--muted)]">{slot.comment}</p>
                          ) : null}
                        </div>
                        <Button
                          size="sm"
                          variant={booked ? 'secondary' : 'default'}
                          disabled={pending === slot.id || (!booked && full)}
                          onClick={() => (booked ? cancel(slot) : setConfirming(slot))}
                        >
                          {pending === slot.id ? '…' : booked ? 'Отменить запись' : 'Записаться'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {mine.length > 0 ? (
        <Card>
          <CardContent className="pt-4 text-sm">
            <p className="font-medium">Ближайшая запись</p>
            <p className="mt-1 text-[var(--muted)]">
              {mine[0]!.courseTitle} — {formatDate(mine[0]!.startsAt)} в{' '}
              {formatTime(mine[0]!.startsAt)}, {mine[0]!.roomName}. Возьмите зачётную книжку.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {confirming ? (
        <BookDialog
          slot={confirming}
          pending={pending === confirming.id}
          onClose={() => setConfirming(null)}
          onConfirm={() => void book(confirming)}
        />
      ) : null}
    </div>
  );
}

// Подтверждение перед записью: дата, время, аудитория, преподаватель и сколько
// мест останется. Без него нажатие «Записаться» меняло базу молча.
function BookDialog({
  slot,
  pending,
  onClose,
  onConfirm,
}: {
  slot: RetakeSlot;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const left = Math.max(0, slot.capacity - slot.booked - 1);

  return (
    <Modal
      title="Записаться на пересдачу?"
      subtitle={slot.courseTitle}
      onClose={onClose}
      initialFocus="dialog"
    >
      <dl className="mt-4 divide-y divide-[var(--border)] text-sm">
        <div className="flex flex-wrap justify-between gap-2 py-2.5">
          <dt className="text-[var(--muted)]">Дата</dt>
          <dd className="font-medium">{formatDate(slot.startsAt)}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2 py-2.5">
          <dt className="text-[var(--muted)]">Время</dt>
          <dd className="font-medium">
            {formatTime(slot.startsAt)}, {slot.durationMin} минут
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2 py-2.5">
          <dt className="text-[var(--muted)]">Аудитория</dt>
          <dd className="font-medium">{slot.roomName}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2 py-2.5">
          <dt className="text-[var(--muted)]">Преподаватель</dt>
          <dd className="font-medium">{slot.teacherName}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2 py-2.5">
          <dt className="text-[var(--muted)]">Места</dt>
          <dd className="font-medium">
            {slot.booked} из {slot.capacity} занято
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-sm text-[var(--muted)]">
        {left > 0
          ? `После записи останется мест: ${left}. Возьмите зачётную книжку.`
          : 'Это последнее место на слоте.'}
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
        <Button onClick={onConfirm} disabled={pending} className="sm:flex-1">
          {pending ? 'Записываем…' : 'Записаться'}
        </Button>
        <Button variant="secondary" onClick={onClose} className="sm:flex-1">
          Отмена
        </Button>
      </div>
    </Modal>
  );
}
