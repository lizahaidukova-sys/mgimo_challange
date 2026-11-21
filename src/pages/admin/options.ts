import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// Справочники для выпадающих списков админки: преподаватели, аудитории,
// дисциплины. Грузятся один раз на страницу, без пагинации — записей мало.

export interface Option {
  value: number;
  label: string;
}

async function fetchOptions(
  endpoint: string,
  label: (row: Record<string, unknown>) => string,
): Promise<Option[]> {
  const data = await api.get<{ rows: Record<string, unknown>[] }>(`${endpoint}?limit=200&offset=0`);
  return data.rows
    .map((row) => ({ value: Number(row.id), label: label(row) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}

export function useTeacherOptions(): Option[] {
  const [options, setOptions] = useState<Option[]>([]);
  useEffect(() => {
    fetchOptions('/api/admin/teachers', (row) => String(row.fullName))
      .then(setOptions)
      .catch(() => setOptions([]));
  }, []);
  return options;
}

export function useRoomOptions(): Option[] {
  const [options, setOptions] = useState<Option[]>([]);
  useEffect(() => {
    fetchOptions('/api/admin/rooms', (row) => `${row.name} — ${row.building}`)
      .then(setOptions)
      .catch(() => setOptions([]));
  }, []);
  return options;
}

export function useCourseOptions(): Option[] {
  const [options, setOptions] = useState<Option[]>([]);
  useEffect(() => {
    fetchOptions('/api/admin/courses', (row) => String(row.title))
      .then(setOptions)
      .catch(() => setOptions([]));
  }, []);
  return options;
}
