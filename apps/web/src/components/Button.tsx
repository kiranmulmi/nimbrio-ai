import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant =
  'primary' | 'soft' | 'ghost' | 'danger' | 'danger-outline' | 'danger-ghost' | 'plain';
type Size = 'md' | 'sm';

const VARIANTS: Record<Variant, string> = {
  primary:
    'border-transparent bg-accent text-on-accent shadow-accent hover:bg-accent-hover enabled:hover:-translate-y-px disabled:shadow-none',
  soft: 'border-transparent bg-accent-soft text-accent-2 hover:bg-accent-bg',
  ghost: 'border-line bg-surface text-ink hover:border-line-strong hover:bg-subtle',
  danger: 'border-transparent bg-danger-line text-white hover:brightness-95',
  'danger-outline': 'border-danger-line bg-surface text-danger hover:bg-danger-bg',
  'danger-ghost': 'border-transparent bg-transparent text-danger hover:bg-danger-bg',
  plain: 'border-transparent bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink',
};

const SIZES: Record<Size, string> = {
  md: 'h-9 px-4 text-[13px]',
  sm: 'h-7 px-3 text-[12px]',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
};

export function Button({
  variant = 'ghost',
  size = 'md',
  className = '',
  type = 'button',
  children,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      type={type}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border font-semibold transition-[background-color,border-color,filter,color,transform] disabled:cursor-not-allowed disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
