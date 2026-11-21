import { useMemo } from 'react';
import { AdminEntity, type AdminColumn, type AdminField } from './AdminEntity';
import { useTeacherOptions } from './options';

const columns: AdminColumn[] = [
  { key: 'title', label: 'Дисциплина' },
  { key: 'teacherName', label: 'Преподаватель' },
  { key: 'credits', label: 'Зачётные единицы', nowrap: true },
  {
    key: 'controlForm',
    label: 'Контроль',
    render: (row) => (row.controlForm === 'exam' ? 'Экзамен' : 'Зачёт'),
  },
  { key: 'hours', label: 'Часы', nowrap: true },
];

export default function AdminCoursesPage() {
  const teachers = useTeacherOptions();

  const fields = useMemo<AdminField[]>(
    () => [
      { key: 'title', label: 'Название', type: 'text', required: true },
      { key: 'teacherId', label: 'Преподаватель', type: 'select', options: teachers, required: true },
      { key: 'credits', label: 'Зачётные единицы', type: 'number', defaultValue: 3, required: true },
      {
        key: 'controlForm',
        label: 'Форма контроля',
        type: 'select',
        options: [
          { value: 'exam', label: 'Экзамен' },
          { value: 'pass', label: 'Зачёт' },
        ],
        defaultValue: 'exam',
      },
      { key: 'hours', label: 'Часы', type: 'number', defaultValue: 144, required: true },
    ],
    [teachers],
  );

  return (
    <AdminEntity
      config={{
        endpoint: '/api/admin/courses',
        title: 'Дисциплины',
        description: 'Дисциплина связывает преподавателя, пары и ведомости студентов.',
        searchable: true,
        columns,
        fields,
        createLabel: 'Добавить дисциплину',
        emptyText: 'Дисциплин не найдено',
      }}
    />
  );
}
