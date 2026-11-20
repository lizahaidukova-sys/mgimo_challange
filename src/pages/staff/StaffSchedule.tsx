import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/ui/states';
import { formatDate, formatTime } from '@/lib/utils';

interface StaffLesson {
  id: number;
  group_name: string;
  course_title: string;
  starts_at: string;
  ends_at: string;
  status: 'normal' | 'moved' | 'cancelled';
  note: string | null;
}

export default function StaffSchedulePage() {
  const [rows, setRows] = useState<StaffLesson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<StaffLesson | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<{ rows: StaffLesson[] }>('/api/staff/lessons')
      .then((data) => setRows(data.rows))
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold sm:text-2xl">Пары на две недели</h1>
      <p className="text-sm text-[var(--muted)]">
        Перенос или отмена уходит в уведомления всем студентам группы. Старое время сохраняется,
        чтобы студент видел, что изменилось.
      </p>

      {loading ? <SkeletonCard rows={6} /> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}

      {!loading && !error && rows ? (
        rows.length === 0 ? (
          <EmptyState title="Пар в этом периоде нет" />
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id}>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{row.course_title}</p>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          {row.group_name} · {formatDate(row.starts_at)} · {formatTime(row.starts_at)}–
                          {formatTime(row.ends_at)}
                        </p>
                        {row.status !== 'normal' ? (
                          <p className="mt-1 text-xs font-medium text-[var(--warning)]">
                            {row.status === 'cancelled' ? 'Отменено' : 'Перенесено'}
                            {row.note ? `: ${row.note}` : ''}
                          </p>
                        ) : null}
                      </div>
                      <Button size="sm" variant="secondary" onClick={() => setSelected(row)}>
                        Изменить
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {selected ? (
        <LessonEditor
          lesson={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function toLocalInput(iso: string): string {
  // <input type="datetime-local"> требует локальное время без Z.
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function LessonEditor({
  lesson,
  onClose,
  onSaved,
}: {
  lesson: StaffLesson;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [startsAt, setStartsAt] = useState(toLocalInput(lesson.starts_at));
  const [endsAt, setEndsAt] = useState(toLocalInput(lesson.ends_at));
  const [status, setStatus] = useState(lesson.status);
  const [note, setNote] = useState(lesson.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (new Date(endsAt) <= new Date(startsAt)) {
      setError('Окончание должно быть позже начала');
      return;
    }
    setPending(true);
    try {
      await api.post(`/api/staff/lessons/${lesson.id}`, {
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        status,
        note,
      });
      toast.success('Пара обновлена, студенты получили уведомление');
      onSaved();
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'Не удалось сохранить';
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end bg-black/40 p-0 sm:items-center sm:justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lesson-editor-title"
    >
      <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-[16px] bg-[var(--surface)] p-4 sm:max-w-md sm:rounded-[12px]">
        <h2 id="lesson-editor-title" className="text-lg font-semibold">
          {lesson.course_title}
        </h2>
        <p className="mt-0.5 text-sm text-[var(--muted)]">{lesson.group_name}</p>

        <form onSubmit={save} className="mt-4">
          <div className="mb-3">
            <Label htmlFor="startsAt">Начало</Label>
            <Input
              id="startsAt"
              type="datetime-local"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </div>
          <div className="mb-3">
            <Label htmlFor="endsAt">Окончание</Label>
            <Input
              id="endsAt"
              type="datetime-local"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </div>
          <div className="mb-3">
            <Label htmlFor="status">Статус</Label>
            <Select
              id="status"
              value={status}
              onChange={(event) => setStatus(event.target.value as StaffLesson['status'])}
            >
              <option value="normal">Обычная пара</option>
              <option value="moved">Перенос</option>
              <option value="cancelled">Отмена</option>
            </Select>
          </div>
          <div className="mb-3">
            <Label htmlFor="note">Комментарий для студентов</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={400}
              placeholder="Например: аудитория изменена на 402"
            />
          </div>

          <FieldError>{error}</FieldError>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row-reverse">
            <Button type="submit" disabled={pending} className="sm:flex-1">
              {pending ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} className="sm:flex-1">
              Отмена
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
