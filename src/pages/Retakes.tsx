import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock, MapPin, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { RetakeSlot } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/ui/states';
import { formatDate, formatTime } from '@/lib/utils';

export default function RetakesPage() {
  const [rows, setRows] = useState<RetakeSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<number | null>(null);

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
        Запись открыта за день до пересдачи. Если мест не осталось — напишите в деканат.
      </p>

      {loading ? <SkeletonCard rows={4} /> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}

      {!loading && !error && rows ? (
        rows.length === 0 ? (
          <EmptyState
            title="Слотов пока нет"
            description="График пересдач публикует деканат — здесь появятся даты и аудитории."
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
                          onClick={() => (booked ? cancel(slot) : book(slot))}
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
    </div>
  );
}
