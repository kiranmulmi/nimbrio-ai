import type { Plan } from '@app/shared';
import { timeAgo } from '../../lib/format';
import { EarlierPlan } from '../panel/plan/EarlierPlan';
import { DoneWhen } from '../panel/plan/DoneWhen';
import { planCounts } from '../panel/plan/planState';
import { SegmentBar } from '../panel/plan/SegmentBar';
import { StatusPill } from '../panel/plan/StatusPill';

/**
 * A plan where the agent made it in the conversation. When its steps show inline (each above
 * the work done for it) this is only the goal, progress and finish line; otherwise (a plan
 * worked on without step updates) it folds open to the step list.
 */
export function PlanCard({ plan, hasInlineSteps }: { plan: Plan; hasInlineSteps: boolean }) {
  if (!hasInlineSteps) return <EarlierPlan plan={plan} />;
  const counts = planCounts(plan);
  const isComplete = counts.done === counts.total;
  return (
    <div className="flex flex-col gap-2 px-2.5 py-2">
      <span className="flex items-center gap-2">
        <StatusPill
          kind={isComplete ? 'complete' : 'gaps'}
          label={
            isComplete
              ? `Plan · ${counts.total} steps`
              : `Plan · ${counts.done}/${counts.total} done`
          }
          timer={null}
        />
        {plan.createdAt && (
          <span className="text-[11.5px] text-ink-3">{timeAgo(plan.createdAt)}</span>
        )}
      </span>
      <p className="text-[12.5px] font-semibold leading-snug text-ink-2">{plan.goal}</p>
      <SegmentBar steps={plan.steps} />
      {plan.doneWhen && <DoneWhen text={plan.doneWhen} />}
    </div>
  );
}
