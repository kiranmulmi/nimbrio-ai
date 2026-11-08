import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon } from '../lib/icons';
import { useToast } from '../lib/toast';

/** A small icon button that copies `text`, showing a tick for a moment after it worked. */
export function CopyButton({
  text,
  label,
  className = '',
}: {
  text: string;
  /** what it copies, for the tooltip and screen readers ("Copy message") */
  label: string;
  className?: string;
}) {
  const toast = useToast();
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (!isCopied) return;
    const timer = window.setTimeout(() => setIsCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [isCopied]);

  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => setIsCopied(true),
      () => toast("Couldn't copy to the clipboard.", 'error'),
    );
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={isCopied ? 'Copied' : label}
      aria-label={isCopied ? 'Copied' : label}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors ${
        isCopied ? 'text-success' : 'text-ink-3 hover:bg-surface-2 hover:text-ink'
      } ${className}`}
    >
      {isCopied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
    </button>
  );
}
