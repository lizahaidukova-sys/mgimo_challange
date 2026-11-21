import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { SearchHit } from '@shared/types';
import { cn } from '@/lib/utils';

const kindLabel: Record<SearchHit['kind'], string> = {
  lesson: 'Расписание',
  grade: 'Дисциплина',
  request: 'Заявка',
  document: 'Документ',
  announcement: 'Объявление',
};

// Поиск по кабинету: ищет по дисциплинам, расписанию, заявкам и документам.
// Открывается из шапки, закрывается Escape.
export function SearchBox() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        setQuery('');
        setHits([]);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setPending(true);
    const timer = setTimeout(() => {
      api
        .get<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(trimmed)}`)
        .then((data) => {
          if (!cancelled) setHits(data.hits);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setPending(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Поиск по кабинету"
        className="grid h-11 w-11 place-items-center rounded-[8px] hover:bg-[var(--bg)]"
      >
        <Search className="size-5 text-[var(--muted)]" />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 bg-black/40 p-4 pt-[8vh]"
          role="dialog"
          aria-modal="true"
          aria-label="Поиск по кабинету"
          onClick={() => setOpen(false)}
        >
          <div
            className="mx-auto w-full max-w-lg overflow-hidden rounded-[12px] bg-[var(--surface)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-3">
              <Search className="size-4 shrink-0 text-[var(--muted)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Дисциплина, заявка, документ…"
                aria-label="Строка поиска"
                className="h-12 flex-1 bg-transparent text-base outline-none"
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Закрыть поиск"
                className="grid h-9 w-9 place-items-center rounded-[6px] hover:bg-[var(--bg)]"
              >
                <X className="size-4 text-[var(--muted)]" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-2">
              {query.trim().length < 2 ? (
                <p className="px-2 py-3 text-sm text-[var(--muted)]">
                  Введите минимум два символа.
                </p>
              ) : pending && hits.length === 0 ? (
                <p className="px-2 py-3 text-sm text-[var(--muted)]">Ищем…</p>
              ) : hits.length === 0 ? (
                <p className="px-2 py-3 text-sm text-[var(--muted)]">
                  Ничего не найдено по запросу «{query.trim()}».
                </p>
              ) : (
                <ul>
                  {hits.map((hit, index) => (
                    <li key={`${hit.kind}-${index}`}>
                      <Link
                        to={hit.href}
                        onClick={() => {
                          setOpen(false);
                          setQuery('');
                          setHits([]);
                        }}
                        className={cn(
                          'block rounded-[8px] px-2 py-2 hover:bg-[var(--bg)]',
                          'min-h-11',
                        )}
                      >
                        <p className="text-sm font-medium">{hit.title}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {kindLabel[hit.kind]} · {hit.detail}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
