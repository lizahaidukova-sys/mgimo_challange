import * as React from 'react';
import { cn } from '@/lib/utils';

// Минимальный tabs-компонент на CSS-состоянии: без клиентской библиотеки,
// клавиатурно доступен через нативные кнопки и aria-selected.

const TabsContext = React.createContext<{
  value: string;
  setValue: (value: string) => void;
} | null>(null);

export function Tabs({
  defaultValue,
  value: controlled,
  onValueChange,
  children,
  className,
}: {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? '');
  const value = controlled ?? internal;
  const setValue = React.useCallback(
    (next: string) => {
      setInternal(next);
      onValueChange?.(next);
    },
    [onValueChange],
  );
  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

function useTabs() {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error('Tabs-компонент вне Tabs');
  return context;
}

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      role="group"
      aria-label="Разделы"
      className={cn(
        'mb-3 inline-flex w-full gap-1 overflow-x-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-1',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  const { value: active, setValue } = useTabs();
  const selected = active === value;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => setValue(value)}
      className={cn(
        'min-h-11 flex-1 whitespace-nowrap rounded-[6px] px-3 text-sm font-medium sm:min-h-9',
        selected ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--muted)]',
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children }: { value: string; children: React.ReactNode }) {
  const { value: active } = useTabs();
  if (active !== value) return null;
  return <div>{children}</div>;
}
