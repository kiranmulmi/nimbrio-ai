import type { NoteItem } from './conversation';

/** A small muted line inside a turn, e.g. why the agent made a plan. */
export function FlowNote({ item }: { item: NoteItem }) {
  const isWarn = item.tone === 'warn';
  return (
    <div
      className={`flex items-center gap-2 px-0.5 text-[13px] ${isWarn ? 'text-warn' : 'text-ink-3'}`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 shrink-0 rotate-45 ${isWarn ? 'bg-warn-line' : 'bg-accent'}`}
      />
      {item.text}
    </div>
  );
}
