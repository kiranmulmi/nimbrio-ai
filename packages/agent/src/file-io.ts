// Safe writes for the JSON files the app keeps in each workspace folder and in ~/.nimbrio-ai.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Write a file all at once: to a temporary file next to it, then renamed over it.
 * A crash midway leaves the old file whole instead of half written. `mode` is set when the
 * temporary file is created, so a private file (0o600) is never readable by others, even briefly.
 */
export async function writeFileAtomic(
  filePath: string,
  data: string,
  { mode }: { mode?: number } = {},
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await fs.writeFile(temporary, data, { mode });
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

const queues = new Map<string, Promise<unknown>>();

/**
 * Run `task` after every earlier task with the same key has finished, so two
 * read-modify-write updates of one file in this process can't lose each other's change.
 */
export function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(task, task);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return result;
}
