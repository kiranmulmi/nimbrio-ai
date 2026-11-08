import { randomUUID } from 'node:crypto';
import type { ApproveFn, SteeringInbox, SteeringMessage } from '@app/agent';
import type { ApprovalMode, StreamEvent } from '@app/shared';

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
/** Messages sent during a run that the agent hasn't read yet, at most. */
export const MAX_WAITING_MESSAGES = 10;

type Settle = (allowed: boolean) => void;

/** Which chats have a run in progress (one at a time per chat), and their open approval requests. */
export class RunRegistry {
  private readonly running = new Map<
    string,
    {
      workspaceId: string;
      stop: AbortController;
      /** Auto-approve from the composer: run tools without asking (approvals set to ask). */
      autoApprove: boolean;
      /** Messages the user sent during the run, until the agent takes them. */
      waiting: SteeringMessage[];
    }
  >();
  private readonly pendingApprovals = new Map<string, Settle>();

  isRunning(chatId: string): boolean {
    return this.running.has(chatId);
  }

  hasAny(): boolean {
    return this.running.size > 0;
  }

  hasRunningIn(workspaceId: string): boolean {
    return [...this.running.values()].some((run) => run.workspaceId === workspaceId);
  }

  /** Claims the chat; the returned signal is aborted when the user stops the run. */
  start(chatId: string, workspaceId: string, autoApprove = false): AbortSignal {
    const stop = new AbortController();
    this.running.set(chatId, { workspaceId, stop, autoApprove, waiting: [] });
    return stop.signal;
  }

  /**
   * Queues a message for the chat's run, read before its next step. Null when none is running
   * (or it has been stopped), 'full' when too many are still waiting.
   */
  steer(chatId: string, text: string): SteeringMessage | 'full' | null {
    const run = this.running.get(chatId);
    if (!run || run.stop.signal.aborted) return null;
    if (run.waiting.length >= MAX_WAITING_MESSAGES) return 'full';
    const message = { id: randomUUID(), text, sentAt: new Date().toISOString() };
    run.waiting.push(message);
    return message;
  }

  /** What the chat's run reads its waiting messages from. */
  inbox(chatId: string): SteeringInbox {
    return {
      take: () => {
        const run = this.running.get(chatId);
        return run ? run.waiting.splice(0) : [];
      },
    };
  }

  /**
   * Turns Auto-approve on or off for the chat's run, from its next approval on (one already
   * waiting still needs an answer). Returns false when none is running.
   */
  setAutoApprove(chatId: string, autoApprove: boolean): boolean {
    const run = this.running.get(chatId);
    if (run) run.autoApprove = autoApprove;
    return Boolean(run);
  }

  /** Stops the chat's run (Stop in any tab). Returns false when none is running. */
  stop(chatId: string): boolean {
    const run = this.running.get(chatId);
    run?.stop.abort();
    return Boolean(run);
  }

  finish(chatId: string): void {
    this.running.delete(chatId);
  }

  /** Answers an approval request. Returns false when it is no longer waiting. */
  settle(approvalId: string, allowed: boolean): boolean {
    const settle = this.pendingApprovals.get(approvalId);
    settle?.(allowed);
    return Boolean(settle);
  }

  /**
   * Approval requests for the chat's run, answered from the browser tab that started it.
   * `denyAll` is called when that tab goes away, so no action is left waiting. With the
   * run's Auto-approve on, `ask` lets tools run without asking; `deny` still refuses them.
   */
  createApprover(chatId: string, mode: ApprovalMode, send: (event: StreamEvent) => void) {
    const mine = new Set<string>();

    const approve: ApproveFn = async (toolName, input) => {
      if (mode === 'deny') return false;
      if (mode === 'auto' || this.running.get(chatId)?.autoApprove) return true;
      const id = randomUUID();
      return new Promise<boolean>((resolve) => {
        const settle: Settle = (allowed) => {
          clearTimeout(timer);
          this.pendingApprovals.delete(id);
          mine.delete(id);
          send({ type: 'approval_closed', id, allowed });
          resolve(allowed);
        };
        const timer = setTimeout(() => settle(false), APPROVAL_TIMEOUT_MS);
        this.pendingApprovals.set(id, settle);
        mine.add(id);
        send({ type: 'approval', id, tool: toolName, input });
      });
    };

    const denyAll = () => {
      for (const id of [...mine]) this.pendingApprovals.get(id)?.(false);
    };

    return { approve, denyAll };
  }
}
