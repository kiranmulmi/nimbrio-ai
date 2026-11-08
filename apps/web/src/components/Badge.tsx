import type { ReactNode } from 'react';

export type BadgeTone = 'blue' | 'coral' | 'green' | 'yellow' | 'red' | 'grey';

const TONES: Record<BadgeTone, string> = {
  blue: 'bg-accent-bg text-accent-2',
  coral: 'bg-coral-bg text-coral',
  green: 'bg-success-bg text-success',
  yellow: 'bg-warn-bg text-warn',
  red: 'bg-danger-bg text-danger',
  grey: 'bg-surface-2 text-ink-2',
};

/** A small filled label tinted by meaning: a status, a mode, a count. */
export function Badge({
  tone = 'grey',
  icon,
  className = '',
  children,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-semibold tabular-nums ${TONES[tone]} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}
