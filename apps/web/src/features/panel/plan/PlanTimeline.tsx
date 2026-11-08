import { useEffect, useRef } from 'react';
import type { Plan, StepStatus } from '@app/shared';
import { PlanFoldRow } from './PlanFoldRow';
import type { PlanPhase } from './planState';
import { PlanStepRow } from './PlanStepRow';

/** The steps as a timeline. Finished steps before the current one fold into one row while the agent works. */
export function PlanTimeline({
  plan,
  phase,
  activity,
  expanded,
  onToggleStep,
  showDone,
  onShowDone,
}: {
  plan: Plan;
  phase: PlanPhase;
  activity: string | null;
  expanded: ReadonlySet<number>;
  onToggleStep: (index: number) => void;
  /** Whether finished steps are shown; null means automatic (folded while working). */
  showDone: boolean | null;
  onShowDone: (show: boolean) => void;
}) {
  const { steps } = plan;
  const activeIndex = steps.findIndex((step) => step.status === 'in_progress');
  const firstOpen = steps.findIndex(
    (step) => step.status === 'pending' || step.status === 'in_progress',
  );
  const leadingFinished = firstOpen === -1 ? steps.length : firstOpen;
  const isFoldable = leadingFinished >= 2 && firstOpen !== -1;
  const isFolded = isFoldable && !(showDone ?? phase === 'idle');

  // Statuses at the last render, to animate steps that were just added or changed.
  const seen = useRef<StepStatus[]>([]);
  const before = seen.current;
  useEffect(() => {
    seen.current = steps.map((step) => step.status);
  });

  // Keep the current step in view as the plan advances.
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (activeIndex !== -1) {
      activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeIndex]);

  const animationOf = (index: number, status: StepStatus) => {
    const previous = before[index];
    if (previous === undefined) return before.length ? 'enter' : null;
    return previous !== status ? 'changed' : null;
  };

  return (
    <ol>
      {isFoldable && (
        <PlanFoldRow
          steps={steps.slice(0, leadingFinished)}
          isFolded={isFolded}
          onToggle={() => onShowDone(isFolded)}
        />
      )}
      {steps.map((step, index) =>
        isFolded && index < leadingFinished ? null : (
          <PlanStepRow
            key={index}
            step={step}
            index={index}
            isActive={index === activeIndex}
            isLast={index === steps.length - 1}
            isExpanded={expanded.has(index)}
            animation={animationOf(index, step.status)}
            activity={phase === 'working' ? activity : null}
            onToggle={() => onToggleStep(index)}
            rowRef={index === activeIndex ? activeRef : undefined}
          />
        ),
      )}
    </ol>
  );
}
