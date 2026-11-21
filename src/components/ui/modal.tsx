import { useEffect, useRef, type ReactNode } from 'react';

// Модальная панель: тот же приём, что в редакторе пары у деканата —
// снизу на телефоне, по центру на десктопе. Фокус входит в первое поле
// и возвращается на кнопку-открывашку после закрытия.

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  initialFocus = 'first',
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * Куда ставить фокус при открытии.
   * `dialog` — на саму панель: для подтверждений это безопаснее, иначе Enter
   * сразу нажимает основную кнопку и действие выполняется случайно.
   */
  initialFocus?: 'first' | 'dialog';
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (initialFocus === 'dialog') {
      panel?.focus();
    } else {
      const first = panel?.querySelector<HTMLElement>(
        'input:not([type="hidden"]), select, textarea, button, [href]',
      );
      first?.focus();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      // Фокус не должен уходить на страницу под диалогом.
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href]',
        ),
      );
      if (focusable.length === 0) return;
      const firstItem = focusable[0]!;
      const lastItem = focusable[focusable.length - 1]!;
      if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      } else if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, [onClose, initialFocus]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end bg-black/40 p-0 sm:items-center sm:justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-[16px] bg-[var(--surface)] p-4 outline-none sm:max-w-lg sm:rounded-[12px]"
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-[var(--muted)]">{subtitle}</p> : null}
        {children}
      </div>
    </div>
  );
}
