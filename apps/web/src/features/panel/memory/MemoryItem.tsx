import type { Memory } from '@app/shared';
import { isoDay } from '../../../lib/format';
import { CrossIcon } from '../../../lib/icons';

export function MemoryItem({ memory, onDelete }: { memory: Memory; onDelete: () => void }) {
  return (
    <li className="group flex items-start gap-2 px-3 py-2.5 text-[13px] text-ink transition-colors [overflow-wrap:anywhere] hover:bg-subtle">
      <div className="min-w-0 flex-1">
        {memory.fact}
        <span className="mt-0.5 block text-[12px] text-ink-3">
          {memory.updatedAt
            ? `updated ${isoDay(memory.updatedAt)}`
            : `saved ${isoDay(memory.createdAt)}`}
        </span>
      </div>
      <button
        type="button"
        title="Forget this"
        aria-label={`Forget: ${memory.fact}`}
        onClick={onDelete}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-3 opacity-0 transition hover:bg-danger-bg hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <CrossIcon size={12} />
      </button>
    </li>
  );
}
