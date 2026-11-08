import { useState } from 'react';
import type { Plan } from '@app/shared';
import { timeAgo } from '../../../lib/format';
import { ChevronRightIcon } from '../../../lib/icons';
import { DoneWhen } from './DoneWhen';
import { planCounts } from './planState';
import { PlanTimeline } from './PlanTimeline';
import { SegmentBar } from './SegmentBar';
import { StatusPill } from './StatusPill';

/**
 * An earlier plan in the chat: folded to its goal and progress, open to its steps. No card:
 * like the tool rows it sits on the chat background, its header lighting up on hover.
 */
export function EarlierPlan({ plan }: { plan: Plan }) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const counts = planCounts(plan);
  const isComplete = counts.done === counts.total;
  const toggleStep = (index: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-col gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-surface [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <StatusPill
            kind={isComplete ? 'complete' : 'gaps'}
            label={isComplete ? 'Complete' : `${counts.done}/${counts.total} done`}
            timer={null}
          />
          {plan.createdAt && (
            <span className="text-[11.5px] text-ink-3">{timeAgo(plan.createdAt)}</span>
          )}
          <ChevronRightIcon
            size={11}
            className="ml-auto shrink-0 text-ink-4 transition-transform group-open:rotate-90"
          />
        </span>
        <span className="line-clamp-2 text-[12.5px] font-semibold leading-snug text-ink-2 group-open:line-clamp-none">
          {plan.goal}
        </span>
        <SegmentBar steps={plan.steps} />
      </summary>
      <div className="flex flex-col gap-3 px-2.5 pb-2 pt-2">
        <PlanTimeline
          plan={plan}
          phase="idle"
          activity={null}
          expanded={expanded}
          onToggleStep={toggleStep}
          showDone
          onShowDone={() => {}}
        />
        {plan.doneWhen && <DoneWhen text={plan.doneWhen} />}
      </div>
    </details>
  );
}
