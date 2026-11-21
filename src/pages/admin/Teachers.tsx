import { AdminEntity, type AdminColumn, type AdminField } from './AdminEntity';

const columns: AdminColumn[] = [
  { key: 'fullName', label: 'ФИО' },
  { key: 'title', label: 'Должность', render: (row) => String(row.title || '—') },
];

const fields: AdminField[] = [
  { key: 'fullName', label: 'ФИО', type: 'text', required: true, placeholder: 'Например: Ольга Ким' },
  { key: 'title', label: 'Должность, степень', type: 'text', placeholder: 'доцент, к.э.н.' },
];

export default function AdminTeachersPage() {
  return (
    <AdminEntity
      config={{
        endpoint: '/api/admin/teachers',
        title: 'Преподаватели',
        description: 'Список ведёт пары и дисциплины. Преподавателя с дисциплинами удалить нельзя.',
        searchable: true,
        columns,
        fields,
        createLabel: 'Добавить преподавателя',
        emptyText: 'Преподавателей не найдено',
      }}
    />
  );
}
