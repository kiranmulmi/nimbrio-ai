import type { Usage } from '@app/shared';
import { compactNumber } from '../../lib/format';
import { TOKENS_BUTTON } from './AgentMessage';
import { ContextMeter } from './ContextMeter';
import type { ConversationState } from './conversation';

/**
 * The line under the message box (and the voice bar): this chat's tokens so far (click them for
 * the breakdown) and how full the context window is. Hidden until there's something to show.
 */
export function ChatUsageLine({
  usage,
  context,
  onShowUsage,
}: {
  usage: Usage;
  context: ConversationState['context'];
  onShowUsage?: () => void;
}) {
  const total = usage.inputTokens + usage.outputTokens;
  if (total === 0 && !context) return null;
  const cached = usage.cachedInputTokens ?? 0;
  const counts = (
    <>
      <span className="font-medium text-ink-2">{compactNumber(usage.inputTokens)}</span> input
      {cached > 0 && (
        <>
          {' '}
          (<span className="font-medium text-ink-2">{compactNumber(cached)}</span> cached)
        </>
      )}{' '}
      · <span className="font-medium text-ink-2">{compactNumber(usage.outputTokens)}</span> output
    </>
  );
  return (
    <p
      className="mx-auto mt-1.5 flex w-full max-w-[1000px] flex-wrap items-center gap-x-1.5 px-1 text-[11.5px] tabular-nums text-ink-3"
      title={`${usage.inputTokens.toLocaleString('en')} input (${cached.toLocaleString('en')} of it read from the model server's cache, billed lower) and ${usage.outputTokens.toLocaleString('en')} output tokens in this chat`}
    >
      <span>Tokens in this chat:</span>
      {onShowUsage && total > 0 ? (
        <button
          type="button"
          onClick={onShowUsage}
          title="Token breakdown: each message's tokens, and each request to the model"
          className={TOKENS_BUTTON}
        >
          {counts}
        </button>
      ) : (
        <span>{counts}</span>
      )}
      {context && (
        <ContextMeter usedTokens={context.usedTokens} windowTokens={context.windowTokens} />
      )}
    </p>
  );
}
