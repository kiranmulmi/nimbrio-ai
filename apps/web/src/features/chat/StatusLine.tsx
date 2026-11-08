import { BulbIcon } from '../../lib/icons';

/** Statuses where the model is thinking ("Thinking… (step 3)", "Planning…"), not running a tool. */
const THINKING = /^(Thinking|Planning)/;

/**
 * "Thinking…", "Running web_search…": what the agent is doing while no text streams. A pulsing
 * bulb while it thinks, a live dot otherwise.
 */
export function StatusLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2.5 px-0.5 text-[13px] text-ink-3" role="status">
      {THINKING.test(text) ? (
        <BulbIcon
          size={14}
          className="shrink-0 animate-pulse text-accent motion-reduce:animate-none"
        />
      ) : (
        <span aria-hidden className="live-dot" />
      )}
      {text}
    </div>
  );
}
