// Reading and writing the app's JSON files: each workspace's .nimbrio-ai/ and ~/.nimbrio-ai/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { errorCode, errorMessage, writeFileAtomic } from '@app/agent';

/** A file's text, or null when it doesn't exist. */
export async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

/** A file's JSON, or null when it doesn't exist. Text that isn't JSON is an error naming the file. */
export async function readJson(file: string): Promise<unknown> {
  const text = await readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${file} is damaged: ${errorMessage(error)}`, { cause: error });
  }
}

/**
 * Write JSON only this user can read (0600, in a 0700 folder when it creates one): the app's
 * own files hold model API keys and MCP server tokens.
 */
export async function writePrivateJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
