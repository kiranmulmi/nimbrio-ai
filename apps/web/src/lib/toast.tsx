import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertCircleIcon, CheckIcon, CrossIcon, InfoIcon, WarnIcon } from './icons';

/**
 * success: it worked. error: it failed. warning: it partly worked, or something changed
 * under the user (e.g. "That chat no longer exists."). info: neutral news.
 */
export type ToastKind = 'success' | 'error' | 'warning' | 'info';

type ToastItem = {
  id: number;
  message: string;
  kind: ToastKind;
  /** bumped when the same toast is shown again, to restart its timer */
  version: number;
};

type ShowToast = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<ShowToast | null>(null);

/** Older toasts drop off beyond this many, so a burst can't cover the screen. */
const MAX_VISIBLE = 4;
const LEAVE_MS = 180;

/**
 * How long a toast stays up. Longer messages stay longer so they can be read to the end,
 * and problems stay longer than confirmations. Hovering or focusing a toast pauses it.
 */
export function toastDuration(message: string, kind: ToastKind): number {
  const reading = message.length * 45;
  if (kind === 'error') return Math.min(12_000, 6000 + reading);
  if (kind === 'warning') return Math.min(10_000, 5000 + reading);
  return Math.min(7000, 3000 + reading);
}

const LOOK: Record<
  ToastKind,
  { label: string; border: string; badge: string; bar: string; icon: ReactNode }
> = {
  success: {
    label: 'Success',
    border: 'border-l-success-line',
    badge: 'bg-success-bg text-success',
    bar: 'bg-success-line',
    icon: <CheckIcon size={14} />,
  },
  error: {
    label: 'Error',
    border: 'border-l-danger-line',
    badge: 'bg-danger-bg text-danger',
    bar: 'bg-danger-line',
    icon: <AlertCircleIcon size={15} />,
  },
  warning: {
    label: 'Warning',
    border: 'border-l-warn-line',
    badge: 'bg-warn-bg text-warn',
    bar: 'bg-warn-line',
    icon: <WarnIcon size={14} />,
  },
  info: {
    label: 'Info',
    border: 'border-l-accent',
    badge: 'bg-accent-soft text-accent',
    bar: 'bg-accent',
    icon: <InfoIcon size={15} />,
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  // Screen readers get the text from always-present live regions: a toast that mounts with
  // its own live role isn't announced reliably everywhere.
  const [announced, setAnnounced] = useState({ polite: '', assertive: '' });
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ShowToast>((message, kind = 'success') => {
    setItems((list) => {
      const same = list.find((t) => t.message === message && t.kind === kind);
      if (same) {
        // The same message again (e.g. a repeated failure): restart it rather than stack a copy.
        return list.map((t) => (t === same ? { ...t, version: t.version + 1 } : t));
      }
      const item = { id: nextId.current++, message, kind, version: 0 };
      return [...list, item].slice(-MAX_VISIBLE);
    });
    setAnnounced(
      kind === 'error' ? { polite: '', assertive: message } : { polite: message, assertive: '' },
    );
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announced.polite}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {announced.assertive}
      </div>
      {items.length > 0 && (
        <section
          aria-label="Notifications"
          className="pointer-events-none fixed inset-x-4 bottom-12 z-[80] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:items-end"
        >
          {items.map((t) => (
            <Toast key={t.id} item={t} onDismiss={remove} />
          ))}
        </section>
      )}
    </ToastContext.Provider>
  );
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const { id, message, kind, version } = item;
  const look = LOOK[kind];
  const duration = toastDuration(message, kind);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const remaining = useRef(duration);

  const dismiss = useCallback(() => {
    setIsLeaving(true);
    window.setTimeout(() => onDismiss(id), LEAVE_MS);
  }, [id, onDismiss]);

  // Shown again: full time again.
  useEffect(() => {
    remaining.current = duration;
  }, [version, duration]);

  useEffect(() => {
    if (isPaused || isLeaving) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(dismiss, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [isPaused, isLeaving, dismiss, version]);

  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
      className={`pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-xl border border-l-4 border-line bg-surface py-3 pl-3 pr-2 shadow-float transition duration-200 motion-safe:animate-toast-in sm:w-[360px] ${look.border} ${
        isLeaving ? 'translate-y-1 opacity-0' : 'opacity-100'
      }`}
    >
      <span
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${look.badge}`}
        aria-hidden="true"
      >
        {look.icon}
      </span>
      <p className="min-w-0 flex-1 self-center break-words py-0.5 text-sm font-medium leading-snug text-ink">
        <span className="sr-only">{look.label}: </span>
        {message}
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notification"
        title="Dismiss"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        <CrossIcon size={12} />
      </button>
      {/* Time left: empties as the toast runs out, and stops while it's paused. */}
      <span
        key={version}
        aria-hidden="true"
        className={`absolute bottom-0 left-0 h-0.5 w-full origin-left opacity-60 motion-safe:animate-toast-timer motion-reduce:hidden ${look.bar}`}
        style={{
          animationDuration: `${duration}ms`,
          animationPlayState: isPaused ? 'paused' : 'running',
        }}
      />
    </div>
  );
}

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used within ToastProvider');
  return show;
}
