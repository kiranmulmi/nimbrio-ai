// The app used to be called agentic-ai and kept its data in `.agentic-ai` folders (in the home
// folder and in each workspace). Store.moveLegacyFolders moves them to the new name on start.
import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_DATA_FOLDER, LEGACY_APP_DATA_FOLDER, errorCode } from '@app/agent';

/**
 * Move the old data folder next to `appHome` (~/.agentic-ai) into `appHome`, and each
 * workspace folder's into its APP_DATA_FOLDER. A file both have stays in the old folder.
 * @returns what happened, one line each, for the log
 */
export async function moveLegacyFolders(
  appHome: string,
  workspaceFolders: string[],
): Promise<string[]> {
  const moves = [
    { from: path.join(path.dirname(appHome), LEGACY_APP_DATA_FOLDER), to: appHome },
    ...workspaceFolders.map((folder) => ({
      from: path.join(folder, LEGACY_APP_DATA_FOLDER),
      to: path.join(folder, APP_DATA_FOLDER),
    })),
  ];
  const notes: string[] = [];
  for (const { from, to } of moves) {
    const leftBehind = await moveFolderContents(from, to);
    if (leftBehind === null) continue;
    notes.push(
      leftBehind.length === 0
        ? `Moved ${from} to ${to}.`
        : `Moved ${from} to ${to}, except ${leftBehind.join(', ')}: already there, so the old copies stay in ${from}.`,
    );
  }
  return notes;
}

/**
 * Move everything in the folder `from` into the folder `to` (created when missing), leaving
 * alone anything `to` already has, then remove `from` if that emptied it. A `from` that is
 * missing or isn't a real folder (a symlink, say) is left as it is.
 * @returns null when there was nothing to move, else the names left behind in `from`
 */
async function moveFolderContents(from: string, to: string): Promise<string[] | null> {
  if (!(await isRealFolder(from))) return null;
  if (!(await exists(to))) {
    await fs.rename(from, to);
    return [];
  }
  const leftBehind: string[] = [];
  for (const name of await fs.readdir(from)) {
    const target = path.join(to, name);
    if (await exists(target)) leftBehind.push(name);
    else await fs.rename(path.join(from, name), target);
  }
  if (leftBehind.length === 0) await fs.rmdir(from);
  return leftBehind;
}

async function isRealFolder(folder: string): Promise<boolean> {
  try {
    return (await fs.lstat(folder)).isDirectory();
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return false;
    throw error;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
}
