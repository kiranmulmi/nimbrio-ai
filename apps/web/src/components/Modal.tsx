import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CrossIcon } from '../lib/icons';
import { IconButton } from './IconButton';

/**
 * An overlay for looking at (or editing) one thing, e.g. a file or a skill. App and workspace
 * settings forms don't go in here; they get their own page.
 */
export function Modal({
  title,
  onClose,
  children,
  actions,
  footer,
  size = 'md',
  titleFont = 'mono',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** buttons in the header, before Close */
  actions?: ReactNode;
  /** a bar under the scrolling body, e.g. a form's Save and Cancel */
  footer?: ReactNode;
  /**
   * `lg`: a roomy form; `xl`: the settings popup, wide and a fixed height so switching its
   * tabs doesn't resize it; `wide`: most of the screen, for reading code
   */
  size?: 'md' | 'lg' | 'xl' | 'wide';
  /** `mono` for a file path, `sans` for a plain title */
  titleFont?: 'mono' | 'sans';
}) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Something inside handled it first (the editor closing its search, say).
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Only the top one closes: a popup opened from this one (the folder picker in a
      // workspace form) sits after it in <body>.
      const open = document.querySelectorAll(
        '[role="dialog"], [role="alertdialog"]:not([aria-hidden="true"])',
      );
      if (open[open.length - 1] !== dialog.current) return;
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Portalled to <body>: a transformed ancestor (the sliding panel) would trap `fixed`.
  return createPortal(
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[70] grid place-items-center"
    >
      <div className="absolute inset-0 bg-overlay" onClick={onClose} />
      <div
        className={`relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-dialog ${
          size === 'wide'
            ? 'h-[86vh] w-[min(1200px,calc(100%-32px))]'
            : size === 'xl'
              ? 'h-[min(820px,88vh)] w-[min(1240px,calc(100%-32px))]'
              : size === 'lg'
                ? 'max-h-[88vh] w-[min(1040px,calc(100%-32px))]'
                : 'max-h-[80vh] w-[min(760px,calc(100%-32px))]'
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line bg-subtle py-2 pl-4 pr-2">
          <strong
            className={`min-w-0 truncate ${
              titleFont === 'mono'
                ? 'font-mono text-[13px] font-medium'
                : 'pl-1 text-[14.5px] font-bold text-ink'
            }`}
          >
            {title}
          </strong>
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            <IconButton onClick={onClose} aria-label="Close" autoFocus>
              <CrossIcon />
            </IconButton>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-subtle px-4 py-3 has-[>div:only-child:empty]:hidden">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
