import { useEffect, type KeyboardEvent, type ReactNode } from 'react';
import { CheckIcon, ChevronDownIcon } from '../../lib/icons';
import { usePopover } from '../../lib/usePopover';

/**
 * A chip in the composer's bottom row that opens a menu above it (the composer sits at
 * the bottom of the screen). Arrow keys move between the items; Escape closes it.
 */
export function ComposerMenu({
  label,
  icon,
  title,
  menuLabel,
  showHeading = true,
  disabled = false,
  className = '',
  footer,
  children,
}: {
  label: ReactNode;
  icon?: ReactNode;
  title: string;
  menuLabel: string;
  /** Shows `menuLabel` above the items; it is always the menu's accessible name. */
  showHeading?: boolean;
  disabled?: boolean;
  className?: string;
  /** Under the items, e.g. a link to manage them. Gets `close`. */
  footer?: (close: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const { isOpen, setIsOpen, ref } = usePopover<HTMLDivElement>();
  const close = () => setIsOpen(false);

  // Focus the chosen item (or the first) as the menu opens, so the arrow keys work at once.
  useEffect(() => {
    if (!isOpen) return;
    const menu = ref.current;
    const item =
      menu?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]') ??
      menu?.querySelector<HTMLElement>('[role^="menuitem"]');
    item?.focus();
  }, [isOpen, ref]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
    );
    const index = items.findIndex((item) => item === document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  };

  return (
    <div ref={ref} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        title={title}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={(event) => {
          // The composer focuses its text box on click; keep focus for the menu instead.
          event.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          isOpen
            ? 'border-accent-bg bg-accent-soft text-accent-2'
            : 'border-transparent text-ink-2 hover:bg-surface-2 hover:text-ink'
        }`}
      >
        {icon}
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDownIcon
          size={10}
          className={`shrink-0 text-ink-3 transition-transform ${isOpen ? '' : 'rotate-180'}`}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label={menuLabel}
          onKeyDown={onMenuKeyDown}
          onClick={(event) => event.stopPropagation()}
          className="absolute bottom-[calc(100%+6px)] left-0 z-30 max-h-[50vh] w-[min(300px,calc(100vw-40px))] overflow-y-auto rounded-xl border border-line bg-surface py-1.5 shadow-float"
        >
          {showHeading && <div className="eyebrow px-3.5 pb-1.5 pt-1">{menuLabel}</div>}
          {children(close)}
          {footer && (
            <>
              <div className="my-1.5 h-px bg-line-2" />
              {footer(close)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One choice in a `ComposerMenu`: one of several (`radio`), or on/off on its own (`checkbox`). */
export function ComposerMenuItem({
  isSelected,
  onSelect,
  title,
  detail,
  badge,
  kind = 'radio',
}: {
  isSelected: boolean;
  onSelect: () => void;
  title: ReactNode;
  detail?: ReactNode;
  badge?: ReactNode;
  kind?: 'radio' | 'checkbox';
}) {
  return (
    <button
      type="button"
      role={kind === 'radio' ? 'menuitemradio' : 'menuitemcheckbox'}
      aria-checked={isSelected}
      onClick={onSelect}
      className={`flex w-full items-start gap-2.5 px-3.5 py-2 text-left outline-none transition-colors hover:bg-subtle focus-visible:bg-subtle ${
        isSelected ? 'bg-accent-soft' : ''
      }`}
    >
      <span className="grid h-[18px] w-3.5 shrink-0 place-items-center text-accent">
        {isSelected && <CheckIcon size={13} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={`truncate text-[13px] ${isSelected ? 'font-medium text-ink' : 'text-ink-2'}`}
          >
            {title}
          </span>
          {badge}
        </span>
        {detail && <span className="mt-0.5 truncate text-[11.5px] text-ink-3">{detail}</span>}
      </span>
    </button>
  );
}
