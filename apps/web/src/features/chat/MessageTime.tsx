import { isRecent, replyTime } from '../../lib/format';
import { useNow } from '../../lib/useNow';

/**
 * When a message was sent or a reply finished ("5m ago", "5 Nov, 14:32"), with the full date
 * and time as a tooltip; refreshed each half minute while relative.
 */
export function MessageTime({ iso, prefix = '' }: { iso: string | null; prefix?: string }) {
  const now = useNow(isRecent(iso, Date.now()), 30_000);
  const { text, title } = replyTime(iso, now);
  if (!text) return null;
  return (
    <>
      {prefix}
      <time dateTime={iso ?? undefined} title={title}>
        {text}
      </time>
    </>
  );
}
