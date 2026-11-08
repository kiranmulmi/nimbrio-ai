/** "1 step", "3 steps". */
export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** "950", "40.4K", "1.2M". */
export function compactNumber(value: number): string {
  return COMPACT.format(value);
}

export function shorten(text: string, max = 140): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** "now", "5m", "3h", "2d", then a short date. */
export function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  const seconds = (Date.now() - time) / 1000;
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d`;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a reply came: relative within a day ("just now", "5m ago", "3h ago"), otherwise the
 * date and time ("5 Nov, 14:32", with the year when it isn't this year). `title` is the
 * full date and time for a tooltip.
 */
export function replyTime(iso: string | null, now: number): { text: string; title: string } {
  if (!iso) return { text: '', title: '' };
  const date = new Date(iso);
  const time = date.getTime();
  if (Number.isNaN(time)) return { text: '', title: '' };
  const title = date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
  const ago = Math.max(now - time, 0);
  if (ago < 60_000) return { text: 'just now', title };
  if (ago < 3_600_000) return { text: `${Math.floor(ago / 60_000)}m ago`, title };
  if (ago < DAY_MS) return { text: `${Math.floor(ago / 3_600_000)}h ago`, title };
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const day = date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const clock = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return { text: `${day}, ${clock}`, title };
}

/** Whether a reply time is still shown as relative, so it needs refreshing. */
export function isRecent(iso: string | null, now: number): boolean {
  const time = iso ? new Date(iso).getTime() : NaN;
  return !Number.isNaN(time) && now - time < DAY_MS;
}

/** "2026-11-03" from an ISO timestamp. */
export function isoDay(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

/** "1:05" for 65 seconds. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function hostOf(url: unknown): string {
  if (typeof url !== 'string') return 'a page';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'a page';
  }
}

/** Tool arguments arrive as a JSON string; anything unparsable becomes an empty object. */
export function parseArgs(args: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(args || '{}');
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** One line for a tool step's summary: `query: cats, limit: 3`. */
export function inlineArgs(args: string): string {
  const parsed = parseArgs(args);
  const entries = Object.entries(parsed);
  if (!entries.length) return args === '{}' ? '' : args;
  return entries
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(', ');
}

/** Indented JSON when the text is JSON, the text itself otherwise. */
export function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
