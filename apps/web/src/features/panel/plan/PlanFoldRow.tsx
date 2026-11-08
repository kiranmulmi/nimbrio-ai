import type { PlanStep } from '@app/shared';
import { plural } from '../../../lib/format';
import { FlagIcon } from '../../../lib/icons';

/** One row standing in for the finished steps at the top of the plan. */
export function PlanFoldRow({
  steps,
  isFolded,
  onToggle,
}: {
  steps: PlanStep[];
  isFolded: boolean;
  onToggle: () => void;
}) {
  const done = steps.filter((step) => step.status === 'done').length;
  const other = steps.length - done;
  return (
    <li className="relative grid grid-cols-[20px_minmax(0,1fr)] gap-2.5 pb-3">
      <span
        aria-hidden
        className={`absolute bottom-0 left-[9.5px] top-[22px] w-px ${
          isFolded ? 'bg-line' : 'bg-success-line'
        }`}
      />
      <span className="grid h-5 w-5 place-items-center rounded-full bg-success-bg text-success">
        <FlagIcon size={11} />
      </span>
      <span className="flex min-h-5 items-center justify-between gap-2 text-[13px] text-ink-3">
        <span>
          {plural(steps.length, 'step')} finished
          {other ? ` (${other} skipped or failed)` : ''}
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!isFolded}
          className="shrink-0 rounded-md border border-line bg-surface px-2 py-0.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
        >
          {isFolded ? 'Show' : 'Hide'}
        </button>
      </span>
    </li>
  );
}
