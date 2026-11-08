import { Markdown } from '../../components/Markdown';
import type { TextItem } from './conversation';

/** Agent text: the answer, an interim note on the way to a tool call, or an error. */
export function TextBlock({ item }: { item: TextItem }) {
  if (!item.text) return null;

  if (item.isError) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-l-4 border-line border-l-danger-line bg-danger-bg px-4 py-3 text-danger [overflow-wrap:anywhere]"
      >
        <Markdown text={item.text} />
      </div>
    );
  }

  if (item.isInterim) {
    return (
      <div className="px-0.5 py-0.5 text-[13px] text-ink-3 [overflow-wrap:anywhere]">
        <Markdown text={item.text} isStreaming={item.isOpen} />
      </div>
    );
  }

  return (
    <div className="chat-card px-5 py-4 leading-relaxed text-ink [overflow-wrap:anywhere]">
      <Markdown text={item.text} isStreaming={item.isOpen} />
    </div>
  );
}
