import type {
  Attachment,
  ChatDetail,
  ModelCallUsage,
  RunResult,
  StreamEvent,
  Usage,
} from '@app/shared';
import { compactNumber, parseArgs, plural } from '../../lib/format';
import { initialPlanState, withPhase, withPlan, type PlanState } from '../panel/plan/planState';
import { PLAN_TOOL_NAMES, addedStepCount, describeActivity } from './tools';

/**
 * One chat as the screen shows it, built from a saved history or from the run's event
 * stream. An agent turn's `flow` holds, in order, everything the agent did: text, notes,
 * tool steps and approval cards. Text written before a tool call stays in place as an
 * interim note; the last text block is the answer.
 */

export type TextItem = {
  kind: 'text';
  key: string;
  text: string;
  /** Still receiving deltas. */
  isOpen: boolean;
  /** Led into a tool call, so it shows as a muted note rather than the answer. */
  isInterim: boolean;
  isError: boolean;
};

export type NoteItem = { kind: 'note'; key: string; text: string; tone: 'info' | 'warn' };

export type ToolState = 'running' | 'ok' | 'error' | 'saved';

export type ToolItem = {
  kind: 'tool';
  key: string;
  callId: string | null;
  name: string;
  args: string;
  state: ToolState;
  result: string;
};

export type ApprovalState = 'pending' | 'sending' | 'allowed' | 'denied';

export type ApprovalItem = {
  kind: 'approval';
  key: string;
  approvalId: string;
  tool: string;
  input: unknown;
  state: ApprovalState;
  error: string | null;
};

/** Where the agent made a plan (create_plan); the chat shows that plan here. */
export type PlanMarkItem = { kind: 'plan'; key: string; callId: string | null; goal: string };

/**
 * Where the agent started (or, without starting it, finished) a plan step: the chat shows the
 * step's text here, above the work that follows. `planKey` is the plan marker it belongs to.
 */
export type StepMarkItem = {
  kind: 'step';
  key: string;
  callId: string | null;
  planKey: string | null;
  /** 1-based, as in update_plan */
  number: number;
};

/**
 * The planning step at the start of a run, where the agent decided whether to plan:
 * "Thought for 12s" once it decided. `durationMs` is null while it's still thinking.
 */
export type ThoughtItem = {
  kind: 'thought';
  key: string;
  /** when planning started (ms), to time it live; null for a saved chat */
  startedAt: number | null;
  durationMs: number | null;
};

export type FlowItem =
  TextItem | NoteItem | ToolItem | ApprovalItem | PlanMarkItem | StepMarkItem | ThoughtItem;

export type UserTurn = {
  role: 'user';
  key: string;
  text: string;
  attachments: Attachment[];
  /** names of the skills picked for it */
  skills: string[];
  /** When it was sent (ISO), shown under it; null when not known. */
  sentAt: string | null;
  /** Sent while the agent worked, and read by that run before its next step. */
  isSteer: boolean;
};

export type AgentTurn = {
  role: 'agent';
  key: string;
  flow: FlowItem[];
  /** A live status line such as "Thinking…", or null when idle. */
  status: string | null;
  /** "3 steps · 1.2K tokens" once the turn ends. */
  meta: string | null;
  /** Its tokens once it ends, for the usage breakdown (null while it runs). */
  usage: TurnUsage | null;
  /** When the reply finished (ISO), shown next to `meta`. */
  finishedAt: string | null;
};

/** What one reply cost: its totals and each model call (none for replies saved before). */
export type TurnUsage = {
  steps: number;
  usage: Usage;
  calls: ModelCallUsage[];
};

export type Turn = UserTurn | AgentTurn;

export type ConversationState = {
  turns: Turn[];
  plan: PlanState;
  /** Tokens of every finished request in this chat, summed. */
  usage: Usage;
  /**
   * How full the model's context window was at the last model call (null until one is made
   * after the chat opens).
   */
  context: { usedTokens: number; windowTokens: number } | null;
  /** Counter for React keys, so the reducer stays pure. */
  seq: number;
};

/** Everything the stream sends after the opening `chat` event. */
export type RunEvent = Exclude<StreamEvent, { type: 'chat' }>;

export type ConversationAction =
  | { type: 'reset' }
  | { type: 'load'; detail: ChatDetail }
  | { type: 'send'; text: string; attachments: Attachment[]; skills: string[]; at: number }
  | { type: 'event'; event: RunEvent; at: number }
  | { type: 'fail'; message: string }
  | { type: 'finish'; at: number }
  | { type: 'stopping' }
  | { type: 'approval_sending'; approvalId: string }
  | { type: 'approval_failed'; approvalId: string; message: string }
  | { type: 'approval_decided'; approvalId: string; allowed: boolean };

export const initialConversation: ConversationState = {
  turns: [],
  plan: initialPlanState,
  usage: { inputTokens: 0, outputTokens: 0 },
  context: null,
  seq: 0,
};

/** For a call whose result was never saved (the run stopped before it ran). */
const RESULT_NOT_KEPT = '(No result was saved for this call.)';

/** Where older messages were summarized for the model (the chat still shows them all). */
const compactionNote = (count: number) =>
  `Summarized the ${plural(count, 'earlier message')} for the model, to stay within its context window. They're still shown here.`;
const STOPPED_NOTE = 'You stopped the agent. What it did up to here is kept.';

/** The goal a create_plan call gave, to tell its plan apart from the chat's others. */
function planGoal(args: string): string {
  try {
    const parsed: unknown = JSON.parse(args);
    const goal =
      typeof parsed === 'object' && parsed !== null ? (parsed as { goal?: unknown }).goal : '';
    return typeof goal === 'string' ? goal.trim() : '';
  } catch {
    return '';
  }
}

const isDecided = (state: ApprovalState) => state === 'allowed' || state === 'denied';

/** "4.4K tokens · 3.9K cached": the cached part is input read from the server's cache. */
export function tokensText(usage: Usage): string {
  const cached = usage.cachedInputTokens ?? 0;
  const total = `${compactNumber(usage.inputTokens + usage.outputTokens)} tokens`;
  return cached ? `${total} · ${compactNumber(cached)} cached` : total;
}

/** "2 steps · 4.4K tokens · 3.9K cached" */
function metaText(steps: number, usage: Usage): string {
  return `${plural(steps, 'step')} · ${tokensText(usage)}`;
}

/**
 * A working copy of the turns. The last agent turn and its flow are copied up front,
 * so the helpers can change them without touching the previous state.
 */
class Draft {
  turns: Turn[];
  seq: number;
  usage: Usage;
  context: ConversationState['context'];
  agent: AgentTurn | null = null;

  constructor(state: ConversationState) {
    this.turns = [...state.turns];
    this.seq = state.seq;
    this.usage = state.usage;
    this.context = state.context;
    const last = this.turns.at(-1);
    if (last?.role === 'agent') {
      this.agent = { ...last, flow: [...last.flow] };
      this.turns[this.turns.length - 1] = this.agent;
    }
  }

  key(prefix: string): string {
    this.seq += 1;
    return `${prefix}${this.seq}`;
  }

  ensureAgent(status: string | null = null): AgentTurn {
    if (!this.agent) {
      this.agent = {
        role: 'agent',
        key: this.key('a'),
        flow: [],
        status,
        meta: null,
        usage: null,
        finishedAt: null,
      };
      this.turns.push(this.agent);
    }
    return this.agent;
  }

  /** Ends the current agent turn; the next agent output starts a new one. */
  endTurn(): void {
    this.agent = null;
  }

  addUser(
    text: string,
    attachments: Attachment[],
    skills: string[],
    sentAt: string | null,
    isSteer = false,
  ): void {
    this.closeSegment(false);
    if (this.agent) this.agent.status = null;
    this.endTurn();
    this.turns.push({
      role: 'user',
      key: this.key('u'),
      text,
      attachments,
      skills,
      sentAt,
      isSteer,
    });
  }

  private lastText(): { item: TextItem; index: number } | null {
    const flow = this.agent?.flow;
    const item = flow?.at(-1);
    return flow && item?.kind === 'text' && item.isOpen ? { item, index: flow.length - 1 } : null;
  }

  /** Finishes the text block being written. `interim` marks text that led into a tool call. */
  closeSegment(interim = true): void {
    const open = this.lastText();
    if (!open || !this.agent) return;
    this.agent.flow[open.index] = { ...open.item, isOpen: false, isInterim: interim };
  }

  appendText(text: string): void {
    const agent = this.ensureAgent();
    const open = this.lastText();
    if (open) {
      agent.flow[open.index] = { ...open.item, text: open.item.text + text };
    } else {
      agent.flow.push({
        kind: 'text',
        key: this.key('t'),
        text,
        isOpen: true,
        isInterim: false,
        isError: false,
      });
    }
  }

  /** A whole text block from a saved chat; it stays open until something follows it. */
  startText(text: string): void {
    this.closeSegment();
    this.appendText(text);
  }

  addBubble(text: string, isError = false): void {
    if (!text) return;
    this.ensureAgent().flow.push({
      kind: 'text',
      key: this.key('t'),
      text,
      isOpen: false,
      isInterim: false,
      isError,
    });
  }

  addNote(text: string, tone: NoteItem['tone'] = 'info'): void {
    this.closeSegment();
    this.ensureAgent().flow.push({ kind: 'note', key: this.key('n'), text, tone });
  }

  /** The planning step began: timed live until its decision (`finishThought`). */
  startThought(at: number): void {
    this.closeSegment();
    this.ensureAgent().flow.push({
      kind: 'thought',
      key: this.key('h'),
      startedAt: at,
      durationMs: null,
    });
  }

  /** The planning step decided: how long it thought. */
  finishThought(at: number): void {
    const flow = this.agent?.flow;
    if (!flow) return;
    for (let index = flow.length - 1; index >= 0; index -= 1) {
      const item = flow[index];
      if (item?.kind !== 'thought') continue;
      if (item.durationMs === null && item.startedAt !== null) {
        flow[index] = { ...item, durationMs: Math.max(0, at - item.startedAt) };
      }
      return;
    }
  }

  /**
   * A saved run's planning step, from its planner call's duration: at the start of the run's
   * first agent turn (the one after the message that started it, not after a steer).
   */
  addSavedThought(durationMs: number): void {
    let index = this.turns.length - 1;
    while (index >= 0) {
      const turn = this.turns[index];
      if (turn?.role === 'user' && !turn.isSteer) break;
      index -= 1;
    }
    index += 1;
    const turn = this.turns[index];
    if (turn?.role !== 'agent') return;
    const thought: ThoughtItem = {
      kind: 'thought',
      key: this.key('h'),
      startedAt: null,
      durationMs,
    };
    const updated: AgentTurn = { ...turn, flow: [thought, ...turn.flow] };
    this.turns[index] = updated;
    if (turn === this.agent) this.agent = updated;
  }

  addTool(callId: string | null, name: string, args: string, state: ToolState, result: string) {
    if (PLAN_TOOL_NAMES.has(name)) {
      if (name === 'create_plan') {
        this.closeSegment();
        this.ensureAgent().flow.push({
          kind: 'plan',
          key: this.key('m'),
          callId,
          goal: planGoal(args),
        });
      } else if (name === 'add_plan_steps') {
        const count = addedStepCount(args);
        if (count) this.addNote(`Added ${plural(count, 'step')} to the plan`);
      } else if (name === 'update_plan') {
        this.markStep(callId, args);
      }
      return;
    }
    this.closeSegment();
    this.ensureAgent().flow.push({
      kind: 'tool',
      key: this.key('s'),
      callId,
      name,
      args,
      state,
      result,
    });
  }

  /** The newest plan marker in the chat, the plan a step update belongs to. */
  private lastPlanKey(): string | null {
    let key: string | null = null;
    for (const turn of this.turns) {
      if (turn.role !== 'agent') continue;
      for (const item of turn.flow) if (item.kind === 'plan') key = item.key;
    }
    return key;
  }

  /** Every step marker in the chat, oldest first. */
  private stepMarks(): StepMarkItem[] {
    return this.turns.flatMap((turn) =>
      turn.role === 'agent'
        ? turn.flow.filter((item): item is StepMarkItem => item.kind === 'step')
        : [],
    );
  }

  /**
   * An update_plan call: starting a step puts its text in the chat, above the work that
   * follows. Finishing (or skipping) a step that was never started marks it too, so every
   * step shows up once; finishing a started one changes only its status, shown in place.
   */
  private markStep(callId: string | null, args: string): void {
    const { step_number: number, status } = parseArgs(args);
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) return;
    const planKey = this.lastPlanKey();
    const marks = this.stepMarks().filter((mark) => mark.planKey === planKey);
    if (status === 'in_progress') {
      if (marks.at(-1)?.number === number) return; // already the step being worked on
    } else if (status === 'done' || status === 'skipped' || status === 'failed') {
      if (marks.some((mark) => mark.number === number)) return;
    } else {
      return;
    }
    this.closeSegment();
    this.ensureAgent().flow.push({ kind: 'step', key: this.key('k'), callId, planKey, number });
  }

  finishTool(callId: string, ok: boolean, preview: string): void {
    const flow = this.agent?.flow;
    if (!flow) return;
    const index = flow.findIndex(
      (item) =>
        (item.kind === 'tool' || item.kind === 'plan' || item.kind === 'step') &&
        item.callId === callId,
    );
    const item = flow[index];
    // A plan call that failed changed nothing: nothing to show in its place.
    if (item?.kind === 'plan' || item?.kind === 'step') {
      if (!ok) flow.splice(index, 1);
      return;
    }
    if (item?.kind !== 'tool') return;
    flow[index] = { ...item, state: ok ? 'ok' : 'error', result: preview };
  }

  addApproval(approvalId: string, tool: string, input: unknown): void {
    this.closeSegment();
    const agent = this.ensureAgent();
    agent.flow.push({
      kind: 'approval',
      key: this.key('p'),
      approvalId,
      tool,
      input,
      state: 'pending',
      error: null,
    });
    agent.status = 'Waiting for your approval…';
  }

  /** Approval cards can sit in an earlier turn, so this looks through all of them. */
  updateApproval(approvalId: string, patch: Partial<Pick<ApprovalItem, 'state' | 'error'>>) {
    this.turns = this.turns.map((turn) => {
      if (turn.role !== 'agent') return turn;
      const index = turn.flow.findIndex(
        (item) => item.kind === 'approval' && item.approvalId === approvalId,
      );
      const item = turn.flow[index];
      if (item?.kind !== 'approval') return turn;
      // Once decided, a late "sending" or failure can't reopen the card.
      if (isDecided(item.state) && !(patch.state && isDecided(patch.state))) return turn;
      const flow = [...turn.flow];
      flow[index] = { ...item, ...patch };
      const updated: AgentTurn = { ...turn, flow };
      if (turn === this.agent) this.agent = updated;
      return updated;
    });
  }

  finishRun(result: RunResult, at: number): void {
    const agent = this.ensureAgent();
    if (result.status === 'done') {
      if (this.lastText()) {
        this.closeSegment(false); // already on screen as it streamed
      } else if (!agent.flow.some((item) => item.kind === 'text' && !item.isInterim)) {
        this.addBubble(result.text);
      }
    } else if (result.status === 'stopped') {
      this.closeSegment(false);
      this.addNote(STOPPED_NOTE);
    } else {
      // Stopped early (limits, truncation, refusal): keep any streamed text, then say why.
      const streamed = this.lastText()?.item.text.trim() ?? '';
      this.closeSegment(false);
      const reason =
        streamed && result.text.startsWith(streamed)
          ? result.text.slice(streamed.length).trim()
          : result.text;
      this.addBubble(reason, true);
    }
    this.addUsage(result.usage);
    agent.meta = metaText(result.steps, result.usage);
    agent.usage = { steps: result.steps, usage: result.usage, calls: result.calls };
    agent.finishedAt = new Date(at).toISOString();
  }

  addUsage({ inputTokens, outputTokens, cachedInputTokens = 0 }: Usage): void {
    this.usage = {
      inputTokens: this.usage.inputTokens + inputTokens,
      outputTokens: this.usage.outputTokens + outputTokens,
      cachedInputTokens: (this.usage.cachedInputTokens ?? 0) + cachedInputTokens,
    };
  }

  setStatus(status: string | null): void {
    this.ensureAgent().status = status;
  }

  result(state: ConversationState, plan: PlanState = state.plan): ConversationState {
    return { turns: this.turns, seq: this.seq, usage: this.usage, context: this.context, plan };
  }
}

/** Draws a saved chat from its history, the same way it looked while it ran. */
function fromHistory(detail: ChatDetail): ConversationState {
  const draft = new Draft(initialConversation);
  for (const item of detail.history) {
    switch (item.role) {
      case 'user':
        draft.addUser(item.text, item.attachments, item.skills, item.sentAt, item.steer ?? false);
        break;
      case 'assistant':
        draft.startText(item.text);
        break;
      case 'tool':
        // A plan call that failed changed nothing, as in the live view.
        if ((item.name === 'create_plan' || item.name === 'update_plan') && !item.ok) break;
        draft.addTool(
          null,
          item.name,
          item.args,
          item.ok ? 'saved' : 'error',
          item.result ?? RESULT_NOT_KEPT,
        );
        break;
      case 'compaction':
        draft.addNote(compactionNote(item.summarizedMessages));
        break;
      case 'meta': {
        draft.closeSegment(false);
        if (item.status === 'refused') {
          draft.addBubble('The model server blocked this response with its content filter.', true);
        } else if (item.status === 'error') {
          draft.addBubble('This request failed before the agent could answer.', true);
        } else if (item.status === 'stopped') {
          draft.addNote(STOPPED_NOTE);
        }
        draft.addUsage(item);
        const turn = draft.ensureAgent();
        turn.meta = metaText(item.steps, item);
        turn.usage = {
          steps: item.steps,
          usage: {
            inputTokens: item.inputTokens,
            outputTokens: item.outputTokens,
            cachedInputTokens: item.cachedInputTokens,
            cacheWriteTokens: item.cacheWriteTokens,
          },
          calls: item.calls,
        };
        turn.finishedAt = item.finishedAt;
        const planner = item.calls.find((call) => call.kind === 'planner');
        if (planner) draft.addSavedThought(planner.durationMs);
        draft.endTurn();
        break;
      }
    }
  }
  draft.closeSegment(false);
  return draft.result(initialConversation, {
    ...initialPlanState,
    plan: detail.plan,
    earlier: detail.earlierPlans,
  });
}

function applyEvent(state: ConversationState, event: RunEvent, at: number): ConversationState {
  const draft = new Draft(state);
  let plan = state.plan;

  switch (event.type) {
    case 'planning':
      draft.startThought(at);
      draft.setStatus('Planning…');
      plan = withPhase(plan, 'planning', at);
      break;
    case 'route':
      draft.finishThought(at);
      if (event.mode === 'plan') {
        // Only why it planned: the plan card under it already shows the steps.
        if (event.reason) draft.addNote(event.reason);
        plan = withPhase(plan, 'working', at);
      } else {
        plan = { ...withPhase(plan, 'idle', at), stale: plan.plan !== null };
      }
      break;
    case 'check': {
      const count = event.unfinished.length;
      const one = count === 1;
      draft.closeSegment(false); // the answer so far stays a proper answer
      draft.addNote(
        `Checking the plan: ${plural(count, 'step')} ${one ? 'is' : 'are'} still open, so the agent goes back to finish or explain ${one ? 'it' : 'them'}.`,
      );
      draft.setStatus('Checking the plan…');
      plan = { ...plan, activity: "Checking the plan's open steps" };
      break;
    }
    case 'limit':
      draft.addNote(
        `Step limit reached (${event.reason}). Writing up what was found so far.`,
        'warn',
      );
      plan = { ...plan, activity: 'Writing up what was found' };
      break;
    case 'model_call':
      draft.setStatus('Thinking…');
      plan = { ...plan, activity: 'Thinking about the next step' };
      break;
    case 'context':
      draft.context = { usedTokens: event.usedTokens, windowTokens: event.windowTokens };
      break;
    case 'compaction':
      draft.addNote(compactionNote(event.summarizedMessages));
      break;
    case 'text_delta':
      draft.setStatus(null); // the text itself shows progress
      draft.appendText(event.text);
      break;
    case 'tool_call':
      if (!PLAN_TOOL_NAMES.has(event.name)) {
        plan = { ...plan, activity: describeActivity(event.name, event.args) };
      }
      draft.addTool(event.id, event.name, event.args, 'running', 'Running…');
      draft.setStatus(`Running ${event.name}…`);
      break;
    case 'tool_result':
      draft.finishTool(event.id, event.ok, event.preview);
      break;
    case 'plan':
      plan = withPlan(withPhase(plan, 'working', at), event.plan);
      break;
    case 'approval':
      draft.addApproval(event.id, event.tool, event.input);
      break;
    case 'approval_closed':
      draft.updateApproval(event.id, { state: event.allowed ? 'allowed' : 'denied', error: null });
      draft.setStatus('Working…');
      break;
    case 'steer':
      // The agent read a message sent while it worked: it shows here, and the work goes on below.
      draft.addUser(event.text, [], [], event.sentAt, true);
      draft.ensureAgent('Thinking…');
      break;
    case 'done':
      draft.finishRun(event.result, at);
      break;
    case 'error':
      draft.closeSegment(false);
      draft.addBubble(event.message, true);
      break;
  }

  return draft.result(state, plan);
}

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case 'reset':
      return initialConversation;
    case 'load':
      return fromHistory(action.detail);
    case 'send': {
      const draft = new Draft(state);
      draft.addUser(
        action.text,
        action.attachments,
        action.skills,
        new Date(action.at).toISOString(),
      );
      draft.ensureAgent('Thinking…');
      return draft.result(state);
    }
    case 'event':
      return applyEvent(state, action.event, action.at);
    case 'fail': {
      const draft = new Draft(state);
      draft.closeSegment(false);
      draft.addBubble(action.message, true);
      return draft.result(state);
    }
    case 'stopping': {
      const draft = new Draft(state);
      draft.setStatus('Stopping…');
      return draft.result(state);
    }
    case 'finish': {
      const draft = new Draft(state);
      draft.closeSegment(false);
      if (draft.agent) draft.agent.status = null;
      return draft.result(state, withPhase(state.plan, 'idle', action.at));
    }
    case 'approval_sending': {
      const draft = new Draft(state);
      draft.updateApproval(action.approvalId, { state: 'sending', error: null });
      return draft.result(state);
    }
    case 'approval_failed': {
      const draft = new Draft(state);
      draft.updateApproval(action.approvalId, { state: 'pending', error: action.message });
      return draft.result(state);
    }
    case 'approval_decided': {
      const draft = new Draft(state);
      draft.updateApproval(action.approvalId, {
        state: action.allowed ? 'allowed' : 'denied',
        error: null,
      });
      return draft.result(state);
    }
  }
}
