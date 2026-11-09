import { BulbIcon } from '../../lib/icons';

/** Statuses where the model is thinking ("Thinking…", "Planning…"), not running a tool. */
const THINKING = /^(Thinking|Planning)/;

/**
 * "Thinking…", "Running web_search…": what the agent is doing while no text streams. A pulsing
 * bulb while it thinks, a live dot otherwise.
 */
export function StatusLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2.5 px-0.5 text-[13px] text-ink-3" role="status">
      {THINKING.test(text) ? (
        <BulbIcon size={15} className="thinking-glow shrink-0 text-accent" />
      ) : (
        <span aria-hidden className="live-dot" />
      )}
      {text}
    </div>
  );
}
