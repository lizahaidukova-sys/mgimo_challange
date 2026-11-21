import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label, Select } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { AdminTable, type AdminColumn } from './AdminTable';

export type { AdminColumn } from './AdminTable';

// Одна реализация списка + формы на все шесть сущностей админки.
// Страницы-конфиги (Lessons.tsx, Teachers.tsx, ...) передают колонки и поля;
// поведение — поиск, создание, правка, удаление — живёт здесь, в одном месте.

export interface AdminField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'datetime' | 'textarea';
  options?: { value: string | number; label: string }[];
  required?: boolean;
  placeholder?: string;
  /** Значение по умолчанию для создания; при правке берётся из записи. */
  defaultValue?: string | number;
  help?: string;
}

export interface AdminEntityConfig {
  endpoint: string;
  title: string;
  description: string;
  /** Поле, по которому сервер умеет искать. Пусто — поиска нет. */
  searchable: boolean;
  columns: AdminColumn[];
  fields: AdminField[];
  createLabel: string;
  emptyText: string;
  /** Как показать запись в заголовке окна правки. По умолчанию — первое поле. */
  rowTitle?: (row: Record<string, unknown>) => string;
  /** Что отправить при правке: по умолчанию все поля формы. */
  toPatch?: (values: Record<string, string>) => Record<string, unknown>;
  /** Что отправить при создании: по умолчанию все поля формы. */
  toCreate?: (values: Record<string, string>) => Record<string, unknown>;
}

type Row = Record<string, unknown>;

interface ListResponse {
  rows: Row[];
  total: number;
}

function toFormValue(value: unknown, field: AdminField): string {
  if (value === null || value === undefined) return field.defaultValue === undefined ? '' : String(field.defaultValue);
  // datetime-local требует локальное время без Z, сервер хранит ISO UTC.
  if (field.type === 'datetime' && typeof value === 'string' && value.length > 0) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  return String(value);
}

function valuesFromRow(row: Row, fields: AdminField[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) values[field.key] = toFormValue(row[field.key], field);
  return values;
}

function emptyValues(fields: AdminField[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    if (field.type === 'select' && field.options?.[0]) {
      values[field.key] = String(field.defaultValue ?? field.options[0].value);
      continue;
    }
    values[field.key] = field.defaultValue === undefined ? '' : String(field.defaultValue);
  }
  return values;
}

function buildPayload(
  values: Record<string, string>,
  fields: AdminField[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.key] ?? '';
    if (field.type === 'number' || field.type === 'select') {
      const option = field.options?.find((entry) => String(entry.value) === raw);
      const numeric = option && typeof option.value === 'number';
      if (numeric) {
        payload[field.key] = Number(raw);
        continue;
      }
      if (field.type === 'select') {
        payload[field.key] = raw;
        continue;
      }
      payload[field.key] = raw.trim() === '' ? null : Number(raw);
      continue;
    }
    if (field.type === 'datetime') {
      payload[field.key] = raw ? new Date(raw).toISOString() : null;
      continue;
    }
    payload[field.key] = raw;
  }
  return payload;
}

export function AdminEntity({ config }: { config: AdminEntityConfig }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(
    async (search: string) => {
      const current = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: '200', offset: '0' });
        if (config.searchable && search.trim()) params.set('query', search.trim());
        const data = await api.get<ListResponse>(`${config.endpoint}?${params.toString()}`);
        // Ответ на устаревший запрос не должен затирать свежий.
        if (current !== requestId.current) return;
        setRows(data.rows);
        setTotal(data.total);
      } catch (caught) {
        if (current !== requestId.current) return;
        setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить список');
      } finally {
        if (current === requestId.current) setLoading(false);
      }
    },
    [config.endpoint, config.searchable],
  );

  const firstRun = useRef(true);
  useEffect(() => {
    void load(query);
    // Первичная загрузка — сразу; дальше поиск идёт с задержкой ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Поиск с задержкой: запрос на каждую букву — лишняя нагрузка и мигание.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = setTimeout(() => void load(query), 250);
    return () => clearTimeout(timer);
  }, [query, load]);

  const columns = useMemo(() => config.columns, [config.columns]);

  // Заголовок записи в подтверждении и окне правки: явное правило конфига,
  // иначе первая колонка таблицы — она всегда человекочитаемая.
  function rowLabel(row: Row): string {
    if (config.rowTitle) return config.rowTitle(row);
    const first = config.columns[0];
    const value = first ? row[first.key] : null;
    return value === null || value === undefined || value === '' ? String(row.id ?? '') : String(value);
  }

  async function remove(row: Row) {
    const title = rowLabel(row);
    if (!window.confirm(`Удалить «${title}»? Действие необратимо.`)) return;
    try {
      await api.del(`${config.endpoint}/${row.id}`);
      toast.success('Удалено');
      void load(query);
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Не удалось удалить');
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{config.title}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">{config.description}</p>
      </div>

      <AdminTable
        columns={columns}
        rows={rows}
        query={query}
        onQuery={setQuery}
        onCreate={() => setCreating(true)}
        onEdit={(row) => setEditing(row)}
        onDelete={(row) => void remove(row)}
        loading={loading}
        error={error}
        emptyText={config.emptyText}
        total={total}
        createLabel={config.createLabel}
        canSearch={config.searchable}
        searchPlaceholder={`Поиск: ${config.title.toLowerCase()}`}
      />

      {(creating || editing) && (
        <EntityForm
          config={config}
          row={editing}
          label={editing ? rowLabel(editing) : config.title}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void load(query);
          }}
        />
      )}
    </div>
  );
}

function EntityForm({
  config,
  row,
  label,
  onClose,
  onSaved,
}: {
  config: AdminEntityConfig;
  row: Row | null;
  label: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    row ? valuesFromRow(row, config.fields) : emptyValues(config.fields),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function update(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    for (const field of config.fields) {
      if (field.required && (values[field.key] ?? '').trim() === '') {
        setError(`Заполните поле «${field.label}»`);
        return;
      }
    }
    setPending(true);
    try {
      if (row) {
        const patch = config.toPatch ? config.toPatch(values) : buildPayload(values, config.fields);
        await api.patch(`${config.endpoint}/${row.id}`, patch);
        toast.success('Сохранено');
      } else {
        const payload = config.toCreate ? config.toCreate(values) : buildPayload(values, config.fields);
        await api.post(config.endpoint, payload);
        toast.success('Добавлено');
      }
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
    <Modal
      title={row ? 'Изменить запись' : 'Новая запись'}
      subtitle={row ? label : config.title}
      onClose={onClose}
    >
      <form onSubmit={submit} className="mt-4" noValidate>
        {config.fields.map((field) => {
          const id = `admin-${field.key}`;
          return (
            <div key={field.key} className="mb-3">
              <Label htmlFor={id}>{field.label}</Label>
              {field.type === 'select' ? (
                <Select
                  id={id}
                  value={values[field.key] ?? ''}
                  onChange={(event) => update(field.key, event.target.value)}
                >
                  {field.options?.map((option) => (
                    <option key={String(option.value)} value={String(option.value)}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              ) : field.type === 'textarea' ? (
                <textarea
                  id={id}
                  value={values[field.key] ?? ''}
                  onChange={(event) => update(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  className="flex min-h-[88px] w-full rounded-[8px] border border-[var(--border)] bg-white px-3 py-2 text-base text-[var(--fg)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)] sm:text-sm"
                />
              ) : (
                <Input
                  id={id}
                  type={field.type === 'datetime' ? 'datetime-local' : field.type}
                  value={values[field.key] ?? ''}
                  onChange={(event) => update(field.key, event.target.value)}
                  placeholder={field.placeholder}
                />
              )}
              {field.help ? <p className="mt-1 text-xs text-[var(--muted)]">{field.help}</p> : null}
            </div>
          );
        })}

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
    </Modal>
  );
}
