/**
 * Paths dropped into the message box show as short tokens ("@clients"), each standing for an
 * absolute path. The tokens are swapped back for the paths when the message is sent, so the
 * agent always gets the exact location.
 */
export interface PathMention {
  path: string;
  kind: 'file' | 'folder';
}

export type Mentions = ReadonlyMap<string, PathMention>;

/** "@clients", or "@src/clients" when another dropped path already took "@clients". */
export function tokenFor(path: string, mentions: Mentions): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  for (let take = 1; take <= parts.length; take += 1) {
    const token = `@${parts.slice(-take).join('/')}`;
    const taken = mentions.get(token);
    if (!taken || taken.path === path) return token;
  }
  return `@${path}`;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every token still in the text, longest first, and only as a whole word. */
function tokenPattern(mentions: Mentions): RegExp | null {
  const tokens = [...mentions.keys()].sort((a, b) => b.length - a.length);
  if (!tokens.length) return null;
  return new RegExp(`(${tokens.map(escape).join('|')})(?=$|[\\s.,;:!?)\\]])`, 'g');
}

/** The message as sent: each token replaced by its absolute path. */
export function expandMentions(text: string, mentions: Mentions): string {
  const pattern = tokenPattern(mentions);
  return pattern ? text.replace(pattern, (token) => mentions.get(token)?.path ?? token) : text;
}

export type MentionPart =
  { type: 'text'; text: string } | { type: 'mention'; text: string; mention: PathMention };

/** The text split into plain runs and tokens, for drawing the tokens as pills. */
export function splitMentions(text: string, mentions: Mentions): MentionPart[] {
  const pattern = tokenPattern(mentions);
  if (!pattern) return [{ type: 'text', text }];
  const parts: MentionPart[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const mention = mentions.get(match[0]);
    if (!mention) continue;
    if (match.index > last) parts.push({ type: 'text', text: text.slice(last, match.index) });
    parts.push({ type: 'mention', text: match[0], mention });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts;
}
