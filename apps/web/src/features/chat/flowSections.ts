import type { FlowItem, StepMarkItem, ToolItem } from './conversation';

/** Consecutive tool calls, drawn as one card. */
export type ToolRun = { kind: 'tools'; key: string; items: ToolItem[] };

export type Block = Exclude<FlowItem, ToolItem | StepMarkItem> | ToolRun;

/** A plan step and the work done for it, up to the next step. */
export type StepSection = { kind: 'section'; key: string; step: StepMarkItem; blocks: Block[] };

export type Section = Block | StepSection;

/**
 * A step's work ends at the next step or plan, an answer (text that didn't lead into a tool
 * call), an error or a note (notes are about the whole run: steps added, the step limit, a
 * plan check, a summary): those stand on their own in the turn.
 */
function endsSection(item: FlowItem): boolean {
  switch (item.kind) {
    case 'plan':
    case 'step':
    case 'note':
      return true;
    case 'text':
      return item.isError || (!item.isInterim && !item.isOpen);
    default:
      return false;
  }
}

/** Groups consecutive tool calls into runs. */
function toBlocks(items: readonly FlowItem[]): Block[] {
  const blocks: Block[] = [];
  for (const item of items) {
    if (item.kind === 'step') continue;
    if (item.kind !== 'tool') {
      blocks.push(item);
      continue;
    }
    const last = blocks.at(-1);
    if (last?.kind === 'tools') last.items.push(item);
    else blocks.push({ kind: 'tools', key: item.key, items: [item] });
  }
  return blocks;
}

/**
 * A turn's flow as the chat draws it: each plan step's text above the tool calls, notes and
 * text that carried it out, and everything else (work before the first step, the answer) on
 * its own, in the order it happened.
 */
export function flowSections(flow: readonly FlowItem[]): Section[] {
  const sections: Section[] = [];
  let loose: FlowItem[] = [];
  let open: { step: StepMarkItem; items: FlowItem[] } | null = null;

  const flushLoose = () => {
    sections.push(...toBlocks(loose));
    loose = [];
  };
  const closeStep = () => {
    if (!open) return;
    sections.push({
      kind: 'section',
      key: open.step.key,
      step: open.step,
      blocks: toBlocks(open.items),
    });
    open = null;
  };

  for (const item of flow) {
    if (item.kind === 'step') {
      closeStep();
      flushLoose();
      open = { step: item, items: [] };
      continue;
    }
    if (open && !endsSection(item)) {
      open.items.push(item);
      continue;
    }
    closeStep();
    loose.push(item);
  }
  closeStep();
  flushLoose();
  return sections;
}
