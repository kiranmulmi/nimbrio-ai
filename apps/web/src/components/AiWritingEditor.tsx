import { useRef, useState, type KeyboardEvent } from 'react';
import { errorMessage } from '../lib/api';
import { SparkIcon, WandIcon } from '../lib/icons';
import { Spinner } from './Spinner';

/** A one-click request: sent as it is; an empty request asks for a tidy-up. */
export interface AiChip {
  label: string;
  request: string;
}

/**
 * A text box with an AI writer attached below it: ask for what you want (or click a chip) and
 * the model writes or rewrites the text in the box. Undo puts the previous text back. Used for
 * a workspace's instructions and a skill's instructions.
 *
 * The box keeps a steady height (`heightClass`), so only its text scrolls and the AI bar stays
 * in view in a popup.
 */
export function AiWritingEditor({
  id,
  value,
  onChange,
  write,
  onUndo,
  onBusyChange,
  hasError,
  describedBy,
  placeholder,
  maxLength,
  requestMaxLength,
  starters,
  refinements,
  askPlaceholder,
  heightClass,
  textClassName = '',
  failMessage = "Couldn't write it.",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Writes the new text from the request and the text in the box now. */
  write: (request: string, current: string) => Promise<string>;
  /** Also runs on Undo, for anything else `write` changed (a skill's description). */
  onUndo?: () => void;
  onBusyChange?: (isBusy: boolean) => void;
  hasError: boolean;
  describedBy?: string;
  placeholder: string;
  maxLength: number;
  requestMaxLength: number;
  /** Shown while the box is empty: what to start from. */
  starters: readonly string[];
  /** Shown once there is text: quick changes. */
  refinements: readonly AiChip[];
  askPlaceholder: { empty: string; filled: string };
  /** A Tailwind height for the text box, e.g. `h-[320px]`. */
  heightClass: string;
  textClassName?: string;
  failMessage?: string;
}) {
  const [request, setRequest] = useState('');
  const [isWriting, setIsWriting] = useState(false);
  const [before, setBefore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const hasText = value.trim() !== '';

  const setBusy = (isBusy: boolean) => {
    setIsWriting(isBusy);
    onBusyChange?.(isBusy);
  };

  const run = (asked: string) => {
    if (isWriting || (!asked.trim() && !hasText)) return;
    setBusy(true);
    setError(null);
    write(asked.trim(), value)
      .then((text) => {
        setBefore(value);
        onChange(text);
        setRequest('');
        box.current?.focus();
      })
      .catch((cause: unknown) => setError(errorMessage(cause, failMessage)))
      .finally(() => setBusy(false));
  };

  const undo = () => {
    if (before === null) return;
    onChange(before);
    onUndo?.();
    setBefore(null);
    box.current?.focus();
  };

  const onRequestKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault(); // not the form's submit
    run(request);
  };

  const canWrite = !isWriting && (request.trim() !== '' || hasText);
  const chips: readonly AiChip[] = hasText
    ? refinements
    : starters.map((starter) => ({ label: starter, request: starter }));

  return (
    <div
      className={`mt-2 flex flex-col overflow-hidden rounded-xl border bg-subtle transition-colors focus-within:border-accent ${
        hasError ? 'border-danger-line' : 'border-line hover:border-line-strong'
      }`}
    >
      <textarea
        ref={box}
        id={id}
        value={value}
        readOnly={isWriting}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={hasError ? true : undefined}
        aria-describedby={describedBy}
        aria-busy={isWriting || undefined}
        onChange={(event) => {
          onChange(event.target.value);
          setBefore(null);
        }}
        className={`block w-full resize-none overflow-y-auto bg-transparent px-4 py-3.5 text-[13.5px] leading-[1.65] text-ink outline-none [scrollbar-gutter:stable] placeholder:text-ink-3 ${heightClass} ${textClassName} ${
          isWriting ? 'animate-pulse opacity-60' : ''
        }`}
      />

      <div className="border-t border-line bg-surface p-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-subtle py-1 pl-2.5 pr-1 transition-colors focus-within:border-accent">
          <SparkIcon size={14} className="shrink-0 text-accent-2" />
          <input
            value={request}
            maxLength={requestMaxLength}
            disabled={isWriting}
            aria-label="Ask the AI assistant to write or change the text"
            placeholder={hasText ? askPlaceholder.filled : askPlaceholder.empty}
            onChange={(event) => setRequest(event.target.value)}
            onKeyDown={onRequestKey}
            className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => run(request)}
            disabled={!canWrite}
            title={
              request.trim()
                ? undefined
                : hasText
                  ? 'Tidy it up: clearer, same meaning'
                  : 'Say what you want first'
            }
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[12px] font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isWriting ? <Spinner size={12} label="Writing" /> : <WandIcon size={13} />}
            {isWriting ? 'Writing…' : hasText ? 'Rewrite' : 'Write'}
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 px-0.5">
          <span className="mr-0.5 text-[11.5px] text-ink-3">
            {hasText ? 'Quick:' : 'Start from:'}
          </span>
          {chips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              disabled={isWriting}
              onClick={() => run(chip.request)}
              className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-2 transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {chip.label}
            </button>
          ))}
          {before !== null && !isWriting && (
            <span className="ml-auto flex items-center gap-1.5 text-[12px] text-ink-3">
              Written by AI, review before saving ·
              <button
                type="button"
                onClick={undo}
                className="font-semibold text-accent-2 hover:underline"
              >
                Undo
              </button>
            </span>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-2 px-0.5 text-[12px] text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
