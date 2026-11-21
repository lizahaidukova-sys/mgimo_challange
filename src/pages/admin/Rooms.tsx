import { AdminEntity, type AdminColumn, type AdminField } from './AdminEntity';

const columns: AdminColumn[] = [
  { key: 'name', label: 'Аудитория', nowrap: true },
  { key: 'building', label: 'Корпус', render: (row) => String(row.building || '—') },
];

const fields: AdminField[] = [
  { key: 'name', label: 'Номер аудитории', type: 'text', required: true, placeholder: '315' },
  { key: 'building', label: 'Корпус', type: 'text', placeholder: 'корпус 1' },
];

export default function AdminRoomsPage() {
  return (
    <AdminEntity
      config={{
        endpoint: '/api/admin/rooms',
        title: 'Аудитории',
        description: 'Занятую аудиторию удалить нельзя: сначала перенесите пару или пересдачу.',
        searchable: true,
        columns,
        fields,
        createLabel: 'Добавить аудиторию',
        emptyText: 'Аудиторий не найдено',
      }}
    />
  );
}
