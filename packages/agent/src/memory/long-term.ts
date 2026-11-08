// Long-term memory: facts that survive between sessions.
// The app keeps them in a JSON file per workspace, <folder>/.nimbrio-ai/memory.json
// (LongTermMemory below, opened by @app/db). Recall is simple keyword overlap -
// good enough to start. Swap in embeddings later without touching the rest of the agent.
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Memory } from '@app/shared';
import { errorCode } from '../errors.js';
import { serialized, writeFileAtomic } from '../file-io.js';

/** Where a workspace's saved facts live. */
export interface MemoryStore {
  all(): Promise<Memory[]>;
  /** Save a fact; an exact copy (ignoring case) returns the existing one. */
  add(fact: string): Promise<Memory>;
  /** Best matches for the query; an empty query returns the most recent facts. */
  search(query: string, limit?: number): Promise<Memory[]>;
  /**
   * Replace the text of one fact, keeping its id. Returns the updated entry, or
   * null when no fact has that id. Ids may be shortened as for remove().
   */
  update(id: string, fact: string): Promise<Memory | null>;
  /**
   * Delete facts by id. An id may be shortened to its first 8 characters, as
   * recall shows them. Returns the deleted entries.
   */
  remove(ids: string[]): Promise<Memory[]>;
  /** Delete every fact. Returns what was deleted. */
  clear(): Promise<Memory[]>;
}

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'is',
  'are',
  'my',
  'me',
  'i',
  'what',
  'do',
  'does',
  'about',
]);

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));

/** Facts sharing the most words with the query, best first (an empty query: the newest). */
export function rankByKeywords<T extends { fact: string }>(
  entries: readonly T[],
  query: string,
  limit = 5,
): T[] {
  const queryWords = new Set(words(query));
  if (queryWords.size === 0) return entries.slice(-limit).reverse();
  return entries
    .map((entry) => ({ entry, score: words(entry.fact).filter((w) => queryWords.has(w)).length }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.entry);
}

/** Ids shorter than 8 characters never match, so a stray "a" can't hit everything. */
export const normalizeId = (id: unknown): string | null => {
  const text = String(id ?? '')
    .trim()
    .toLowerCase();
  return text.length >= 8 ? text : null;
};

/**
 * The saved facts as a list for the model, newest last. Long lists are cut to
 * the newest entries; the rest stay reachable through the recall tool.
 */
export function renderMemories(
  entries: readonly Pick<Memory, 'id' | 'fact'>[],
  { max = 40, maxChars = 6000 }: { max?: number; maxChars?: number } = {},
): string {
  const lines: string[] = [];
  let chars = 0;
  for (const e of [...entries].reverse()) {
    const line = `- [id ${e.id.slice(0, 8)}] ${e.fact}`;
    if (lines.length >= max || chars + line.length > maxChars) break;
    lines.unshift(line);
    chars += line.length;
  }
  const hidden = entries.length - lines.length;
  if (hidden > 0) lines.unshift(`(${hidden} older memories not shown; use recall to search them.)`);
  return lines.join('\n');
}

const fileSchema = z.array(
  z.object({
    id: z.string(),
    fact: z.string(),
    createdAt: z.string().nullable().default(null),
    updatedAt: z.string().nullable().default(null),
  }),
);

export class LongTermMemory implements MemoryStore {
  constructor(readonly filePath: string) {}

  async #load(): Promise<Memory[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }
    return fileSchema.parse(JSON.parse(raw));
  }

  async #save(entries: Memory[]): Promise<void> {
    await writeFileAtomic(this.filePath, `${JSON.stringify(entries, null, 2)}\n`);
  }

  /** Changes run one at a time per file, so concurrent chats can't drop each other's facts. */
  #change<T>(task: () => Promise<T>): Promise<T> {
    return serialized(this.filePath, task);
  }

  add(fact: string): Promise<Memory> {
    return this.#change(() => this.#add(fact));
  }

  async #add(fact: string): Promise<Memory> {
    const entries = await this.#load();
    const existing = entries.find((e) => e.fact.toLowerCase() === fact.toLowerCase());
    if (existing) return existing;
    const entry: Memory = {
      id: randomUUID(),
      fact,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    entries.push(entry);
    await this.#save(entries);
    return entry;
  }

  async search(query: string, limit = 5): Promise<Memory[]> {
    return rankByKeywords(await this.#load(), query, limit);
  }

  async all(): Promise<Memory[]> {
    return this.#load();
  }

  update(id: string, fact: string): Promise<Memory | null> {
    return this.#change(() => this.#update(id, fact));
  }

  async #update(id: string, fact: string): Promise<Memory | null> {
    const wanted = normalizeId(id);
    if (!wanted) return null;
    const entries = await this.#load();
    const entry = entries.find((e) => e.id.toLowerCase().startsWith(wanted));
    if (!entry) return null;
    entry.fact = fact;
    entry.updatedAt = new Date().toISOString();
    // Updating can turn it into a copy of another fact; keep just one.
    const rest = entries.filter((e) => e === entry || e.fact.toLowerCase() !== fact.toLowerCase());
    await this.#save(rest);
    return entry;
  }

  remove(ids: string[]): Promise<Memory[]> {
    return this.#change(() => this.#remove(ids));
  }

  async #remove(ids: string[]): Promise<Memory[]> {
    const wanted = ids.map(normalizeId).filter((id): id is string => id !== null);
    if (wanted.length === 0) return [];
    const entries = await this.#load();
    const matches = (entry: Memory) => wanted.some((id) => entry.id.toLowerCase().startsWith(id));
    const removed = entries.filter(matches);
    if (removed.length) await this.#save(entries.filter((e) => !matches(e)));
    return removed;
  }

  clear(): Promise<Memory[]> {
    return this.#change(async () => {
      const entries = await this.#load();
      if (entries.length) await this.#save([]);
      return entries;
    });
  }
}
