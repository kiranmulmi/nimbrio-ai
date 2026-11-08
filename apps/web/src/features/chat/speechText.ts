// Voice mode reads the agent's reply aloud while it streams. These turn the streamed
// Markdown into sentences worth saying: code blocks are skipped, formatting marks, links and
// table pipes are dropped, and text is handed over one finished sentence at a time.

/** Markdown answer text as plain words for a speech voice. */
export function toSpeakable(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images: their alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links: their text
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/`([^`]*)`/g, '$1') // inline code
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // headings
    .replace(/^\s*>\s?/gm, '') // quotes
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '') // list markers
    .replace(/^[\s|:-]+$/gm, '') // table separator rows
    .replace(/\|/g, ' ')
    .replace(/(\*\*|__|\*|~~)(?=\S)([\s\S]*?\S)\1/g, '$2') // bold, italics, strikethrough
    .replace(/\s+/g, ' ')
    .trim();
}

/** A stretch of the raw text kept for speaking, and where it starts in the raw text. */
type Kept = { text: string; from: number };

/**
 * The text with fenced code blocks taken out, and cut at a block that hasn't closed yet. The
 * kept stretches say where they came from, so a spoken sentence maps back to the raw text.
 */
function withoutCode(text: string): Kept[] {
  const kept: Kept[] = [];
  let at = 0;
  for (;;) {
    const rest = text.slice(at);
    const open = rest.search(/(^|\n)[ \t]*```/);
    if (open === -1) {
      kept.push({ text: rest, from: at });
      return kept;
    }
    kept.push({ text: rest.slice(0, open + (rest[open] === '\n' ? 1 : 0)), from: at });
    const afterOpen = rest.indexOf('```', open) + 3;
    const close = rest.slice(afterOpen).search(/\n[ \t]*```/);
    if (close === -1) return kept; // still streaming: say nothing past it yet
    const closeEnd = rest.indexOf('```', afterOpen + close) + 3;
    const lineEnd = rest.indexOf('\n', closeEnd);
    at = lineEnd === -1 ? text.length : at + lineEnd;
  }
}

/** The kept text joined, and a way to turn a position in it back into one in the raw text. */
function speakableSource(text: string) {
  const kept = withoutCode(text);
  return {
    text: kept.map((part) => part.text).join(''),
    toRaw(position: number): number {
      let offset = 0;
      for (const part of kept) {
        if (position <= offset + part.text.length) return part.from + (position - offset);
        offset += part.text.length;
      }
      return text.length;
    },
  };
}

/** Where the last finished sentence ends: after `.`, `!`, `?` or `…` and a space, or a line break. */
function lastSentenceEnd(text: string): number {
  let end = -1;
  for (const match of text.matchAll(/[.!?…]["')\]]*\s|\n/g)) end = match.index + match[0].length;
  return end;
}

/** A sentence to say, and where it ends in the reply's raw text (to show the text up to it). */
export type SpokenSentence = { text: string; end: number };

/** Sentences of one finished chunk (each a short utterance: long ones get cut off). */
function sentences(chunk: string): { text: string; end: number }[] {
  const out: { text: string; end: number }[] = [];
  let from = 0;
  const add = (to: number, end: number) => {
    const text = toSpeakable(chunk.slice(from, to));
    if (/[\p{L}\p{N}]/u.test(text)) out.push({ text, end });
    from = end;
  };
  for (const match of chunk.matchAll(/(?<=[.!?…]["')\]]*)\s+|\n+/g)) {
    add(match.index, match.index + match[0].length);
  }
  add(chunk.length, chunk.length);
  return out;
}

/**
 * Collects a streamed reply and hands back the sentences that are finished. `push` takes each
 * piece of text as it arrives; `end` returns whatever is left (a tool call cut the text there,
 * or the reply finished). Positions count over the whole reply until `reset`.
 */
export function createSpeechSplitter() {
  let text = '';
  let spoken = 0;
  // Raw text of the reply's earlier segments (before tool calls).
  let base = 0;

  const take = (isEnd: boolean): SpokenSentence[] => {
    const source = speakableSource(text);
    const rest = source.text.slice(spoken);
    const end = isEnd ? rest.length : lastSentenceEnd(rest);
    if (end <= 0) return [];
    const chunkStart = spoken;
    spoken += end;
    return sentences(rest.slice(0, end)).map((sentence) => ({
      text: sentence.text,
      end: base + source.toRaw(chunkStart + sentence.end),
    }));
  };

  return {
    push(piece: string): SpokenSentence[] {
      text += piece;
      return take(false);
    },
    end(): SpokenSentence[] {
      const last = take(true);
      base += text.length;
      text = '';
      spoken = 0;
      return last;
    },
    /** Starts over for a new reply. */
    reset() {
      text = '';
      spoken = 0;
      base = 0;
    },
  };
}
