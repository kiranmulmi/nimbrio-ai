import { useMemo, useState, type ReactNode } from 'react';
import type { Attachment, Skill, Workspace } from '@app/shared';
import { PageLoader } from '../../components/PageLoader';
import { AgentMessage } from './AgentMessage';
import { PlanDock } from './PlanDock';
import { placePlans } from './planPlacement';
import { Composer } from './Composer';
import type { ConversationState } from './conversation';
import type { QueuedMessage, ReplyStreamEvent, ReturnedDraft } from './useConversation';
import { isSpeechInputSupported } from './useSpeechInput';
import { isSpeechOutputSupported } from './useSpeechOutput';
import { VoiceBar } from './VoiceBar';
import { EmptyState } from './EmptyState';
import { RunningElsewhereNotice } from './RunningElsewhereNotice';
import { useStickToBottom } from './useStickToBottom';
import { UserMessage } from './UserMessage';
import { TokenUsageDialog, type UsageView } from './TokenUsageDialog';
import { messageUsages } from './tokenUsage';

/**
 * The middle column: the conversation and the message box, or in voice mode the voice bar
 * (the message box stays where the browser can't listen or talk, e.g. Firefox).
 */
export function ChatView({
  workspaceId,
  chatKey,
  state,
  workspace,
  showWorkspaceName,
  isBusy,
  isLoading,
  isRunningElsewhere,
  hasModel,
  modelControls,
  skills,
  onSend,
  onSteer,
  queued,
  restoreDraft,
  onImprove,
  onStop,
  isStopping,
  onDecide,
  onReload,
  isVoiceMode,
  subscribeReply,
}: {
  /** From the URL, so files can be attached before the workspace has loaded. */
  workspaceId: string;
  chatKey: string;
  state: ConversationState;
  workspace: Workspace | null;
  showWorkspaceName: boolean;
  isBusy: boolean;
  isLoading: boolean;
  isRunningElsewhere: boolean;
  hasModel: boolean;
  /** The composer's model and reasoning effort pickers. */
  modelControls: ReactNode;
  /** The workspace's skills, offered in the composer; null while loading. */
  skills: Skill[] | null;
  onSend: (text: string, attachments: Attachment[], skills: string[]) => void;
  /** Sends a message to this tab's run in progress, read before its next step. */
  onSteer: (text: string) => void;
  /** Messages sent during the run that the agent hasn't read yet. */
  queued: QueuedMessage[];
  /** A message that came back unread, for the message box. */
  restoreDraft: ReturnedDraft | null;
  /** Rewrites a draft prompt (the composer's improve button). */
  onImprove: (text: string) => Promise<string>;
  onStop: () => void;
  isStopping: boolean;
  onDecide: (approvalId: string, allow: boolean) => void;
  onReload: () => void;
  /** The workspace chats by voice. */
  isVoiceMode: boolean;
  /** The reply as it streams, for reading it aloud. */
  subscribeReply: (listener: (event: ReplyStreamEvent) => void) => () => void;
}) {
  const canTalk = isVoiceMode && isSpeechInputSupported() && isSpeechOutputSupported();
  // Voice mode shows the newest reply's text only up to what's being said (null: all of it).
  const [spokenUpTo, setSpokenUpTo] = useState<number | null>(null);
  const revealUpTo = canTalk ? spokenUpTo : null;
  const scrollContent = useMemo(() => [state.turns, revealUpTo], [state.turns, revealUpTo]);
  const log = useStickToBottom<HTMLDivElement>(scrollContent, chatKey);
  const plans = useMemo(() => placePlans(state.turns, state.plan), [state.turns, state.plan]);
  const [usageView, setUsageView] = useState<UsageView | null>(null);
  const usageRows = useMemo(() => messageUsages(state.turns), [state.turns]);
  const isEmpty = state.turns.length === 0;
  const canSend = !isBusy && !isRunningElsewhere && !isLoading;
  // While this tab's run works, the box stays open: what's sent goes to the agent mid-run.
  const canSteer = isBusy && !isLoading;
  const lastTurn = state.turns.at(-1);
  const hasPendingApproval = state.turns.some(
    (turn) =>
      turn.role === 'agent' &&
      turn.flow.some(
        (item) =>
          item.kind === 'approval' && (item.state === 'pending' || item.state === 'sending'),
      ),
  );

  const send = (text: string, attachments: Attachment[], picked: string[]) => {
    log.pin();
    onSend(text, attachments, picked);
  };

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--chat-bg)]">
      <div
        ref={log.ref}
        onScroll={log.onScroll}
        aria-live="polite"
        className={`min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-5 sm:px-6 ${
          !isLoading && isEmpty ? 'dot-grid' : ''
        }`}
      >
        <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-5">
          {isLoading && isEmpty && <PageLoader label="Opening chat…" />}
          {!isLoading && isEmpty && (
            <EmptyState workspace={workspace} showWorkspaceName={showWorkspaceName} />
          )}
          {state.turns.map((turn) =>
            turn.role === 'user' ? (
              <UserMessage
                key={turn.key}
                text={turn.text}
                attachments={turn.attachments}
                skills={turn.skills}
                sentAt={turn.sentAt}
                isSteer={turn.isSteer}
                workspaceId={workspaceId}
              />
            ) : (
              <AgentMessage
                key={turn.key}
                turn={turn}
                plans={plans}
                onDecide={onDecide}
                onShowUsage={() => setUsageView({ kind: 'reply', key: turn.key })}
                revealUpTo={turn === lastTurn ? revealUpTo : null}
              />
            ),
          )}
          {isRunningElsewhere && !isBusy && (
            <RunningElsewhereNotice onReload={onReload} onStop={onStop} isStopping={isStopping} />
          )}
        </div>
      </div>
      <PlanDock state={state.plan} />
      {queued.length > 0 && (
        <ul
          aria-label="Messages waiting for the agent"
          className="mx-auto flex w-full max-w-[1000px] flex-col items-end gap-1 px-4 pb-1 sm:px-6"
        >
          {queued.map((message) => (
            <li
              key={message.key}
              title={message.text}
              className="flex max-w-[92%] items-center gap-1.5 rounded-xl border border-dashed border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink-2 md:max-w-[80%]"
            >
              <span className="shrink-0 text-ink-3">Waiting for the next step:</span>
              <span className="min-w-0 truncate">{message.text}</span>
            </li>
          ))}
        </ul>
      )}
      {isVoiceMode && !canTalk && (
        <p className="mx-auto -mb-1 w-full max-w-[1000px] px-4 text-[12.5px] text-ink-3 sm:px-6">
          Voice mode is on, but this browser can&apos;t listen or talk. Use Chrome, Edge or Safari
          for it; type here meanwhile.
        </p>
      )}
      {canTalk ? (
        <VoiceBar
          disabled={!canSend}
          hasModel={hasModel}
          isRunning={isBusy}
          isStopping={isStopping}
          hasPendingApproval={hasPendingApproval}
          controls={modelControls}
          usage={state.usage}
          context={state.context}
          onShowUsage={() => setUsageView({ kind: 'chat' })}
          onSend={(text) => send(text, [], [])}
          onStop={onStop}
          subscribeReply={subscribeReply}
          onSpokenUpTo={setSpokenUpTo}
        />
      ) : (
        <Composer
          workspaceId={workspaceId}
          disabled={!canSend && !canSteer}
          hasModel={hasModel}
          controls={modelControls}
          skills={skills}
          focusKey={chatKey}
          usage={state.usage}
          context={state.context}
          onShowUsage={() => setUsageView({ kind: 'chat' })}
          onSend={send}
          onImprove={onImprove}
          isRunning={isBusy}
          isStopping={isStopping}
          onStop={onStop}
          onSteer={onSteer}
          restoreDraft={restoreDraft}
        />
      )}
      {usageView && (
        <TokenUsageDialog rows={usageRows} view={usageView} onClose={() => setUsageView(null)} />
      )}
    </main>
  );
}
