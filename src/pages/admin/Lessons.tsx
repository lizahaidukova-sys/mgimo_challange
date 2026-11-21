import { useMemo } from 'react';
import { AdminEntity, type AdminColumn, type AdminField } from './AdminEntity';
import { useCourseOptions, useRoomOptions } from './options';
import { formatDateTime } from '@/lib/utils';

const columns: AdminColumn[] = [
  { key: 'startsAt', label: 'Начало', render: (row) => formatDateTime(String(row.startsAt)), nowrap: true },
  { key: 'courseTitle', label: 'Дисциплина' },
  { key: 'groupName', label: 'Группа', nowrap: true },
  { key: 'roomName', label: 'Аудитория', nowrap: true },
  { key: 'kind', label: 'Вид', nowrap: true },
  {
    key: 'status',
    label: 'Статус',
    render: (row) => (row.status === 'moved' ? 'Перенос' : row.status === 'cancelled' ? 'Отмена' : 'Обычная'),
  },
  { key: 'note', label: 'Комментарий', render: (row) => String(row.note || '—') },
];

export default function AdminLessonsPage() {
  const courses = useCourseOptions();
  const rooms = useRoomOptions();

  const fields = useMemo<AdminField[]>(
    () => [
      { key: 'courseId', label: 'Дисциплина', type: 'select', options: courses, required: true },
      { key: 'roomId', label: 'Аудитория', type: 'select', options: rooms, required: true },
      { key: 'groupName', label: 'Группа', type: 'text', required: true, defaultValue: 'МЭО-3-1' },
      { key: 'startsAt', label: 'Начало', type: 'datetime', required: true },
      { key: 'endsAt', label: 'Окончание', type: 'datetime', required: true },
      { key: 'kind', label: 'Вид занятия', type: 'text', defaultValue: 'лекция' },
      {
        key: 'status',
        label: 'Статус',
        type: 'select',
        options: [
          { value: 'normal', label: 'Обычная' },
          { value: 'moved', label: 'Перенос' },
          { value: 'cancelled', label: 'Отмена' },
        ],
        defaultValue: 'normal',
      },
      {
        key: 'note',
        label: 'Комментарий для студентов',
        type: 'textarea',
        placeholder: 'Например: аудитория изменена на 402',
      },
    ],
    [courses, rooms],
  );

  return (
    <AdminEntity
      config={{
        endpoint: '/api/admin/lessons',
        title: 'Пары',
        description: 'Расписание всех групп. Изменения сразу видны студенту в разделе «Расписание».',
        searchable: false,
        columns,
        fields,
        createLabel: 'Добавить пару',
        emptyText: 'Пар пока нет',
        rowTitle: (row) => `${String(row.courseTitle)} — ${formatDateTime(String(row.startsAt))}`,
      }}
    />
  );
}
