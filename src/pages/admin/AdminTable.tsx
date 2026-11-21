import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/ui/states';

// Таблица админки: на десктопе — обычная таблица, на телефоне — карточки.
// Одна разметка данных, два представления: горизонтальной прокрутки нет ни на 360 px,
// ни на большом экране.

export interface AdminColumn {
  key: string;
  label: string;
  render?: (row: Record<string, unknown>) => ReactNode;
  /** Скрыть колонку в карточке на телефоне: она дублирует заголовок. */
  hideOnMobile?: boolean;
  /** Короткие коды («МЭО-3-1», даты) не переносить: иначе слово рвётся. */
  nowrap?: boolean;
}

export function AdminTable({
  columns,
  rows,
  query,
  onQuery,
  onCreate,
  onEdit,
  onDelete,
  loading,
  error,
  emptyText,
  total,
  createLabel = 'Добавить',
  searchPlaceholder = 'Поиск',
  canSearch = true,
}: {
  columns: AdminColumn[];
  rows: Record<string, unknown>[];
  query: string;
  onQuery: (value: string) => void;
  onCreate: () => void;
  onEdit: (row: Record<string, unknown>) => void;
  onDelete: (row: Record<string, unknown>) => void;
  loading: boolean;
  error: string | null;
  emptyText: string;
  total: number;
  createLabel?: string;
  searchPlaceholder?: string;
  canSearch?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {canSearch ? (
          <Input
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="sm:max-w-xs"
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">Всего записей: {total}</p>
        )}
        <Button onClick={onCreate} className="sm:ml-auto">
          <Plus />
          {createLabel}
        </Button>
      </div>

      {error ? <ErrorState message={error} /> : null}

      {loading && rows.length === 0 ? <SkeletonCard rows={6} /> : null}

      {!loading && !error && rows.length === 0 ? <EmptyState title={emptyText} /> : null}

      {rows.length > 0 ? (
        <>
          {canSearch ? (
            <p className="text-xs text-[var(--muted)]">Найдено: {total}</p>
          ) : null}

          {/* Десктоп: таблица */}
          <div className="hidden overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)] md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--muted)]">
                  {columns.map((column) => (
                    <th key={column.key} scope="col" className="px-3 py-2 font-medium">
                      {column.label}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={String(row.id)} className="border-b border-[var(--border)] last:border-0">
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={column.nowrap ? 'whitespace-nowrap px-3 py-2 align-top' : 'px-3 py-2 align-top'}
                      >
                        {column.render ? column.render(row) : String(row[column.key] ?? '')}
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={() => onEdit(row)}>
                          Изменить
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => onDelete(row)}>
                          Удалить
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Мобильный: карточки */}
          <ul className="space-y-2 md:hidden">
            {rows.map((row) => (
              <li
                key={String(row.id)}
                className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3"
              >
                <dl className="divide-y divide-[var(--border)]">
                  {columns
                    .filter((column) => !column.hideOnMobile)
                    .map((column) => (
                      <div key={column.key} className="flex flex-wrap justify-between gap-2 py-1.5 first:pt-0">
                        <dt className="text-xs text-[var(--muted)]">{column.label}</dt>
                        <dd className="text-right text-sm font-medium">
                          {column.render ? column.render(row) : String(row[column.key] ?? '')}
                        </dd>
                      </div>
                    ))}
                </dl>
                <div className="mt-2 flex gap-2">
                  <Button variant="secondary" size="sm" className="flex-1" onClick={() => onEdit(row)}>
                    Изменить
                  </Button>
                  <Button variant="secondary" size="sm" className="flex-1" onClick={() => onDelete(row)}>
                    Удалить
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
