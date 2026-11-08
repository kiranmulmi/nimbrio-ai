import { BulbIcon } from '../../lib/icons';
import type { ThoughtItem } from './conversation';

/** "12s", "1m 5s": how long the planning step thought, never under a second. */
export function thoughtDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const rest = seconds % 60;
  return rest ? `${Math.floor(seconds / 60)}m ${rest}s` : `${seconds / 60}m`;
}

/**
 * "Thought for 12s" where the run's planning step decided. Nothing while it still thinks: the
 * status line says "Planning…" then.
 */
export function ThoughtLine({ item }: { item: ThoughtItem }) {
  if (item.durationMs === null) return null;
  return (
    <div className="flex items-center gap-2 px-0.5 text-[13px] text-ink-3">
      <BulbIcon size={14} className="shrink-0 text-ink-4" />
      Thought for {thoughtDuration(item.durationMs)}
    </div>
  );
}
