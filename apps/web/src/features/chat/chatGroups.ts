import type { ChatSummary } from '@app/shared';

const DAY = 86_400_000;

const GROUPS = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older'] as const;
type GroupLabel = (typeof GROUPS)[number];

export interface ChatGroup {
  label: GroupLabel;
  chats: ChatSummary[];
}

function groupOf(iso: string | null, startOfToday: number): GroupLabel {
  const time = iso ? new Date(iso).getTime() : Number.NaN;
  if (Number.isNaN(time)) return 'Older';
  if (time >= startOfToday) return 'Today';
  if (time >= startOfToday - DAY) return 'Yesterday';
  if (time >= startOfToday - 7 * DAY) return 'Previous 7 days';
  if (time >= startOfToday - 30 * DAY) return 'Previous 30 days';
  return 'Older';
}

/** Chats bucketed by calendar day of their last activity, keeping the list's order in each bucket. */
export function groupChatsByDay(chats: ChatSummary[], now = new Date()): ChatGroup[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets = new Map<GroupLabel, ChatSummary[]>();
  for (const chat of chats) {
    const label = groupOf(chat.updatedAt ?? chat.createdAt, startOfToday);
    buckets.set(label, [...(buckets.get(label) ?? []), chat]);
  }
  return GROUPS.flatMap((label) => {
    const grouped = buckets.get(label);
    return grouped ? [{ label, chats: grouped }] : [];
  });
}
