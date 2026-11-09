import { useState } from 'react';
import { Spinner } from '../../components/Spinner';
import { CheckIcon, ChevronDownIcon, WarnIcon } from '../../lib/icons';
import { readPref, writePref } from '../../lib/storage';
import { DoneWhen } from '../panel/plan/DoneWhen';
import { planCounts, type PlanState } from '../panel/plan/planState';
import { PlanTimeline } from '../panel/plan/PlanTimeline';
import { SegmentBar } from '../panel/plan/SegmentBar';

const OPEN_KEY = 'agent.planDockOpen';

/**
 * The current plan, docked above the message box so its progress stays in view however far
 * the conversation scrolls: one line folded (status, count, the step in progress), the
 * steps when opened. Shown while the plan has open steps or the agent works through it.
 */
export function PlanDock({ state }: { state: PlanState }) {
  const [isOpen, setIsOpen] = useState(() => readPref(OPEN_KEY) === 'true');
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const [showDone, setShowDone] = useState<boolean | null>(null);
  const { plan } = state;
  if (!plan || state.stale) return null;
  const counts = planCounts(plan);
  const isWorking = state.phase === 'working';
  if (!isWorking && counts.open === 0) return null;

  const activeIndex = plan.steps.findIndex((step) => step.status === 'in_progress');
  const nextIndex =
    activeIndex !== -1 ? activeIndex : plan.steps.findIndex((step) => step.status === 'pending');
  const focus = plan.steps[nextIndex];
  const toggle = () =>
    setIsOpen((open) => {
      writePref(OPEN_KEY, String(!open));
      return !open;
    });
  const toggleStep = (index: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <div className="shrink-0 px-4 sm:px-6">
      <section
        aria-label="Task"
        className="chat-card mx-auto w-full max-w-[1000px] overflow-hidden"
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-subtle"
        >
          <span className="grid h-5 w-5 shrink-0 place-items-center">
            {isWorking ? (
              <Spinner size={12} label="Working" />
            ) : counts.done === counts.total ? (
              <CheckIcon size={13} className="text-success" />
            ) : (
              <WarnIcon size={13} className="text-warn" />
            )}
          </span>
          <span className="shrink-0 text-[12.5px] font-bold text-ink">
            Task{' '}
            <span className="font-semibold tabular-nums text-ink-3">
              {counts.done}/{counts.total}
            </span>
          </span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2" title={focus?.text}>
            {focus
              ? `${activeIndex !== -1 ? 'Now' : 'Next'}: ${focus.text}`
              : isWorking
                ? (state.activity ?? 'Working…')
                : plan.goal}
          </span>
          <span className="hidden w-32 shrink-0 sm:block">
            <SegmentBar steps={plan.steps} />
          </span>
          <ChevronDownIcon
            size={11}
            className={`shrink-0 text-ink-3 transition-transform ${isOpen ? '' : 'rotate-180'}`}
          />
        </button>
        {isOpen && (
          <div className="flex max-h-[38vh] flex-col gap-3 overflow-y-auto border-t border-line-2 px-4 py-3">
            <p className="text-[13px] font-bold leading-snug text-ink">{plan.goal}</p>
            <PlanTimeline
              plan={plan}
              phase={state.phase}
              activity={state.activity}
              expanded={expanded}
              onToggleStep={toggleStep}
              showDone={showDone}
              onShowDone={setShowDone}
            />
            {plan.doneWhen && <DoneWhen text={plan.doneWhen} />}
          </div>
        )}
      </section>
    </div>
  );
}
