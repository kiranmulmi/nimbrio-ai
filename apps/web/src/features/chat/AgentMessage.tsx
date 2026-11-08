import type { ReactNode } from 'react';
import { CopyButton } from '../../components/CopyButton';
import type { AgentTurn } from './conversation';
import { flowSections, type Block } from './flowSections';
import { PlanCard } from './PlanCard';
import type { PlacedPlan } from './planPlacement';
import { PlanStepSection } from './PlanStepSection';
import { ApprovalCard } from './ApprovalCard';
import { FlowNote } from './FlowNote';
import { MessageTime } from './MessageTime';
import { StatusLine } from './StatusLine';
import { TextBlock } from './TextBlock';
import { ThoughtLine } from './ThoughtLine';
import { ToolSteps } from './ToolStep';

/** The reply's answer text (not notes on the way to a tool call, nor errors), as Markdown. */
function answerText(turn: AgentTurn): string {
  return turn.flow
    .flatMap((item) =>
      item.kind === 'text' && !item.isInterim && !item.isError ? [item.text] : [],
    )
    .map((text) => text.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * One agent turn: its text, notes, tool steps and approvals in the order they happened, then
 * a copy button for the answer and its steps and tokens once it has finished. Work done for a
 * plan step sits under that step's text.
 */
export function AgentMessage({
  turn,
  plans,
  onDecide,
  onShowUsage,
  revealUpTo = null,
}: {
  turn: AgentTurn;
  /** the plan each create_plan call made (planPlacement) */
  plans: ReadonlyMap<string, PlacedPlan>;
  onDecide: (approvalId: string, allow: boolean) => void;
  /** Opens this reply's token usage breakdown. */
  onShowUsage?: () => void;
  /**
   * Voice mode: show the reply's text only up to this many characters (counted over its text
   * blocks in order, as streamed), so it appears as it's read aloud; null shows it all.
   */
  revealUpTo?: number | null;
}) {
  let unrevealed = revealUpTo ?? Infinity;

  const renderBlock = (block: Block): ReactNode => {
    switch (block.kind) {
      case 'tools':
        return <ToolSteps key={block.key} items={block.items} />;
      case 'plan': {
        // The plan itself, where the agent made it.
        const placed = plans.get(block.key);
        return placed ? (
          <PlanCard key={block.key} plan={placed.plan} hasInlineSteps={placed.hasInlineSteps} />
        ) : null;
      }
      case 'text': {
        if (block.isError) return <TextBlock key={block.key} item={block} />;
        const shown =
          block.text.length <= unrevealed
            ? block
            : { ...block, text: block.text.slice(0, unrevealed), isOpen: true };
        unrevealed = Math.max(0, unrevealed - block.text.length);
        return <TextBlock key={block.key} item={shown} />;
      }
      case 'note':
        return <FlowNote key={block.key} item={block} />;
      case 'thought':
        return <ThoughtLine key={block.key} item={block} />;
      case 'approval':
        return <ApprovalCard key={block.key} item={block} onDecide={onDecide} />;
    }
  };

  const blocks = flowSections(turn.flow).map((section) => {
    if (section.kind !== 'section') return renderBlock(section);
    const { step } = section;
    const plan = step.planKey ? plans.get(step.planKey)?.plan : undefined;
    return (
      <PlanStepSection
        key={section.key}
        step={plan?.steps[step.number - 1] ?? null}
        number={step.number}
        hasWork={section.blocks.length > 0}
      >
        {section.blocks.map(renderBlock)}
      </PlanStepSection>
    );
  });
  const answer = answerText(turn);

  return (
    <div className="flex flex-col gap-1.5">
      {blocks}
      {turn.status && <StatusLine text={turn.status} />}
      {!turn.status && revealUpTo === null && (answer || turn.meta) && (
        <div className="-ml-1.5 flex items-center gap-1 text-[12px] text-ink-3">
          {answer && <CopyButton text={answer} label="Copy response" />}
          {turn.meta && (
            <span className={answer ? '' : 'pl-1.5'}>
              {turn.meta}
              <MessageTime iso={turn.finishedAt} prefix=" · " />
            </span>
          )}
          {turn.usage && onShowUsage && (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                onClick={onShowUsage}
                title="Each request this reply sent to the model, and its tokens"
                className="rounded-sm text-ink-3 underline decoration-line-strong underline-offset-2 hover:text-accent-2 hover:decoration-current"
              >
                Token breakdown
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
