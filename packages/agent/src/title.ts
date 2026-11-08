// A short title for a chat, written by the model from the user's messages, so the sidebar
// shows what a chat is about instead of its first line ("hello").
import type { CallModel } from './llm.js';

const TITLE_PROMPT = `You name conversations for a chat list.
Reply with only a title for the conversation the user's messages start: 2 to 6 words, in the user's language, about its topic or goal.
No quotes, no emoji, no "Title:", no trailing punctuation.
If there is no topic yet (only a greeting or small talk), reply exactly: New conversation`;

const MAX_TITLE_CHARS = 60;

/** The model's reply as a title: its first line, without quotes, labels or end punctuation. */
export function cleanTitle(raw: string): string | null {
  const line = raw
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return null;
  const title = line
    .replace(/^title\s*:\s*/i, '')
    .replace(/[*_`#"“”'‘’]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s.!?:;,]+$/, '')
    .trim();
  if (!title) return null;
  if (title.length <= MAX_TITLE_CHARS) return title;
  const cut = title.slice(0, MAX_TITLE_CHARS);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 20 ? cut.lastIndexOf(' ') : MAX_TITLE_CHARS).trimEnd()}…`;
}

/**
 * A title for a chat from what the user has asked so far (oldest first), or null when the
 * model gives nothing usable. One short, tool-free model call.
 */
export async function suggestChatTitle(
  callModel: CallModel,
  userMessages: readonly string[],
): Promise<string | null> {
  const listed = userMessages
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => `${index + 1}. ${text.length > 600 ? `${text.slice(0, 600)}…` : text}`)
    .join('\n');
  if (!listed) return null;
  const { message } = await callModel({
    system: TITLE_PROMPT,
    messages: [{ role: 'user', content: `The user's messages:\n${listed}` }],
  });
  return cleanTitle(message.content ?? '');
}
