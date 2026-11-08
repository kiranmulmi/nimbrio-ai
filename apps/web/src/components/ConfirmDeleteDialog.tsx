import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TrashIcon } from '../lib/icons';
import { Button } from './Button';
import { Spinner } from './Spinner';

export function ConfirmDeleteDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    // Captured first and marked handled, so a popup behind it (Modal) stays open.
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (!busy) onCancel();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, busy, onCancel]);

  // Portalled to <body>: a transformed ancestor (the sliding panel) would trap `fixed`.
  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-hidden={!open}
      aria-label={title}
      className={`fixed inset-0 z-[70] grid place-items-center transition-opacity duration-150 ${
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none invisible opacity-0'
      }`}
    >
      <div className="absolute inset-0 bg-overlay" onClick={busy ? undefined : onCancel} />
      <div
        className={`relative w-[min(440px,calc(100%-32px))] rounded-2xl border border-line bg-surface p-6 shadow-dialog transition-transform duration-200 ${
          open ? 'translate-y-0 scale-100' : 'translate-y-1.5 scale-[0.98]'
        }`}
      >
        <div className="mb-4 grid h-10 w-10 place-items-center rounded-lg bg-danger-bg text-danger">
          <TrashIcon size={18} />
        </div>
        <h3 className="mb-1.5 text-[17px] font-bold text-ink">{title}</h3>
        <div className="mb-6 text-[14px] leading-relaxed text-ink-2">{message}</div>
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy} autoFocus={open}>
            {busy && <Spinner size={13} />}
            {busy ? 'Deleting…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
