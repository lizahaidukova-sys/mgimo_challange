import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-[8px] bg-[var(--border)]/60', className)}
      aria-hidden="true"
      {...props}
    />
  );
}

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4">
      <Skeleton className="mb-3 h-4 w-1/3" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-3.5 w-full" />
        ))}
      </div>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
      <p className="text-sm font-medium text-[var(--fg)]">Не удалось загрузить</p>
      <p className="mt-1 text-sm text-[var(--muted)]">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 h-11 rounded-[8px] border border-[var(--border)] px-4 text-sm font-medium hover:bg-[var(--bg)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Повторить
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-[12px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center">
      <p className="text-sm font-medium text-[var(--fg)]">{title}</p>
      {description ? <p className="mt-1 text-sm text-[var(--muted)]">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
