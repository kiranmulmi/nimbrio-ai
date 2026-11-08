/**
 * Splits JSON text into coloured pieces for display. It only tokenizes (no parse), so it
 * also works on half-streamed or slightly broken JSON; anything it doesn't recognise is
 * kept as plain text, so joining the pieces always gives back the input.
 */

export type JsonTokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'plain';

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

// A string (a key when a colon follows), a number, a literal, or punctuation.
const TOKEN =
  /("(?:\\.|[^"\\\n])*")(?=\s*:)|("(?:\\.|[^"\\\n])*")|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false)\b|\b(null)\b|([{}[\],:])/g;

const KINDS: JsonTokenKind[] = ['key', 'string', 'number', 'boolean', 'null', 'punct'];

export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index;
    if (start > last) tokens.push({ kind: 'plain', text: text.slice(last, start) });
    const group = match.slice(1).findIndex((value) => value !== undefined);
    tokens.push({ kind: KINDS[group] ?? 'plain', text: match[0] });
    last = start + match[0].length;
  }
  if (last < text.length) tokens.push({ kind: 'plain', text: text.slice(last) });
  return tokens;
}

/** An object or array that parses: worth colouring even when nothing says it is JSON. */
export function isJson(text: string): boolean {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}
