import { AdminEntity, type AdminColumn, type AdminField } from './AdminEntity';
import { formatShortDate } from '@/lib/utils';

const columns: AdminColumn[] = [
  { key: 'title', label: 'Семестр' },
  { key: 'number', label: 'Номер' },
  { key: 'startsOn', label: 'Начало', render: (row) => formatShortDate(String(row.startsOn)), nowrap: true },
  { key: 'endsOn', label: 'Конец', render: (row) => formatShortDate(String(row.endsOn)), nowrap: true },
  {
    key: 'sessionEndsOn',
    label: 'Конец сессии',
    render: (row) => formatShortDate(String(row.sessionEndsOn)),
  },
  { key: 'isCurrent', label: 'Текущий', render: (row) => (row.isCurrent ? 'да' : 'нет') },
];

const fields: AdminField[] = [
  { key: 'title', label: 'Название', type: 'text', required: true, defaultValue: '3 курс, весна' },
  { key: 'number', label: 'Номер семестра', type: 'number', defaultValue: 6, required: true },
  { key: 'startsOn', label: 'Начало', type: 'datetime', required: true },
  { key: 'endsOn', label: 'Конец занятий', type: 'datetime', required: true },
  { key: 'sessionEndsOn', label: 'Конец сессии', type: 'datetime', required: true },
  {
    key: 'isCurrent',
    label: 'Текущий семестр',
    type: 'select',
    options: [
      { value: 1, label: 'Да' },
      { value: 0, label: 'Нет' },
    ],
    defaultValue: 0,
  },
];

export default function AdminSemestersPage() {
  return (
    <AdminEntity
      config={{
        endpoint: '/api/admin/semesters',
        title: 'Семестры',
        description: 'Границы семестров задают зачётку и обратный отсчёт до конца сессии.',
        searchable: true,
        columns,
        fields,
        createLabel: 'Добавить семестр',
        emptyText: 'Семестров не найдено',
      }}
    />
  );
}
