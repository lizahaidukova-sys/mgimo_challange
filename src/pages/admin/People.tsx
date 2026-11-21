import { AdminEntity, type AdminColumn, type AdminField } from './AdminEntity';

const columns: AdminColumn[] = [
  { key: 'fullName', label: 'ФИО' },
  { key: 'email', label: 'E-mail' },
  {
    key: 'role',
    label: 'Роль',
    render: (row) => (row.role === 'staff' ? 'Сотрудник' : 'Студент'),
  },
  { key: 'faculty', label: 'Факультет', render: (row) => String(row.faculty || '—') },
  { key: 'groupName', label: 'Группа', render: (row) => String(row.groupName || '—'), nowrap: true },
];

const fields: AdminField[] = [
  { key: 'fullName', label: 'ФИО', type: 'text', required: true },
  { key: 'email', label: 'E-mail', type: 'text', required: true, placeholder: 'name@demo.local' },
  {
    key: 'role',
    label: 'Роль',
    type: 'select',
    options: [
      { value: 'student', label: 'Студент' },
      { value: 'staff', label: 'Сотрудник деканата' },
    ],
    defaultValue: 'student',
  },
  { key: 'faculty', label: 'Факультет', type: 'text' },
  { key: 'program', label: 'Направление', type: 'text' },
  { key: 'course', label: 'Курс (0 для сотрудника)', type: 'number', defaultValue: 3 },
  { key: 'groupName', label: 'Группа', type: 'text', placeholder: 'МЭО-3-1' },
];

export default function AdminPeoplePage() {
  return (
    <AdminEntity
      config={{
        endpoint: '/api/admin/users',
        title: 'Люди',
        description:
          'Студенты и сотрудники. Новый человек входит с паролем demo12345; аккаунты администраторов здесь не показываются.',
        searchable: true,
        columns,
        fields,
        createLabel: 'Добавить человека',
        emptyText: 'Никого не найдено',
      }}
    />
  );
}
