import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** A square, borderless button for a single icon. Give it an `aria-label`. */
export function IconButton({
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      {...rest}
      type={type}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-transparent bg-transparent text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}
