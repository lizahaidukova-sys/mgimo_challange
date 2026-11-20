import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        neutral: 'border-[var(--border)] bg-[var(--bg)] text-[var(--fg)]',
        accent: 'border-transparent bg-[var(--accent-soft)] text-[var(--accent)]',
        success: 'border-transparent bg-[var(--success-soft)] text-[var(--success)]',
        warning: 'border-transparent bg-[var(--warning-soft)] text-[var(--warning)]',
        error: 'border-transparent bg-[var(--error-soft)] text-[var(--error)]',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
