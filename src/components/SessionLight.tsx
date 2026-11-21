import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleDot } from 'lucide-react';
import type { SessionState } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, formatDate, plural } from '@/lib/utils';

export function statusVariant(status: string): 'neutral' | 'accent' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'submitted':
      return 'neutral';
    case 'in_progress':
      return 'accent';
    case 'ready':
      return 'success';
    case 'rejected':
      return 'error';
    default:
      return 'neutral';
  }
}

const severityMap = {
  green: {
    label: 'Низкий риск',
    short: 'Норма',
    icon: CheckCircle2,
    className: 'border-[var(--success)]/25 bg-[var(--success-soft)]',
    iconClass: 'text-[var(--success)]',
    badge: 'success' as const,
  },
  yellow: {
    label: 'Требует внимания',
    short: 'Внимание',
    icon: CircleDot,
    className: 'border-[var(--warning)]/25 bg-[var(--warning-soft)]',
    iconClass: 'text-[var(--warning)]',
    badge: 'warning' as const,
  },
  red: {
    label: 'Высокий риск',
    short: 'Риск',
    icon: AlertTriangle,
    className: 'border-[var(--error)]/25 bg-[var(--error-soft)]',
    iconClass: 'text-[var(--error)]',
    badge: 'error' as const,
  },
};

export function SessionLight({ state, compact = false }: { state: SessionState; compact?: boolean }) {
  const config = severityMap[state.severity];
  const Icon = config.icon;

  return (
    <section
      className={cn('rounded-[12px] border p-4', config.className)}
      aria-labelledby="session-light-title"
    >
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 size-5 shrink-0', config.iconClass)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 id="session-light-title" className="text-base font-semibold">
              {state.headline}
            </h2>
            <Badge variant={config.badge}>
              <span className="min-[400px]:hidden">{config.short}</span>
              <span className="hidden min-[400px]:inline">{config.label}</span>
            </Badge>
          </div>
          <p className="mt-1 text-sm text-[var(--fg)]/85">{state.explanation}</p>

          {!compact && state.actions.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {state.actions.map((action, index) => (
                <li
                  key={action.courseId}
                  className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">
                      {index + 1}. {action.title}
                    </p>
                    {action.daysLeft !== null ? (
                      <span
                        className={
                          action.daysLeft < 0
                            ? 'shrink-0 text-xs font-medium text-[var(--error)]'
                            : action.daysLeft <= 2
                              ? 'shrink-0 text-xs font-medium text-[var(--warning)]'
                              : 'shrink-0 text-xs text-[var(--muted)]'
                        }
                      >
                        {action.daysLeft < 0
                          ? `просрочен на ${Math.abs(action.daysLeft)} ${plural(Math.abs(action.daysLeft), 'день', 'дня', 'дней')}`
                          : action.daysLeft === 0
                            ? 'срок сегодня'
                            : `осталось ${action.daysLeft} ${plural(action.daysLeft, 'день', 'дня', 'дней')}`}
                      </span>
                    ) : action.deadline ? (
                      <span className="shrink-0 text-xs text-[var(--muted)]">
                        до {formatDate(action.deadline)}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{action.why}</p>
                </li>
              ))}
            </ul>
          ) : null}

          {compact ? (
            <Button asChild variant="secondary" className="mt-3">
              <Link to="/grades">Что закрыть</Link>
            </Button>
          ) : (
            <p className="mt-3 text-xs text-[var(--muted)]">
              Статус и приоритет посчитаны правилами по вашим оценкам.
              {state.generatedBy === 'llm' ? ' Формулировка — ИИ, числа не менялись.' : ''}
              {state.gpa !== null ? ` Средний балл: ${state.gpa.toFixed(2)}.` : ''}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
