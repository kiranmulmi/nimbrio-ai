import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { APP_DATA_FOLDER, expandHome } from '@app/agent';

/** The files that say what a project is, in the order they are worth reading. */
const DESCRIBING_FILES = [
  'README.md',
  'readme.md',
  'README',
  'package.json',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'composer.json',
  'pom.xml',
  'Gemfile',
];
/** Top-level names that say nothing about the project. */
const SKIPPED_NAMES = new Set(['node_modules', APP_DATA_FOLDER]);
const MAX_NAMES = 60;
const MAX_FILE_CHARS = 2500;
const MAX_FILES = 2;

/**
 * A short look at a workspace folder for the instructions assistant: its top-level names and
 * the start of a README or manifest. Only plain files at the top are read (no symlinks, no
 * hidden or app-data files), and nothing at all for the disk root or the home folder, which
 * can't be workspaces. Null when the folder doesn't exist yet or can't be read.
 */
export async function peekProject(requested: string | undefined): Promise<string | null> {
  if (!requested?.trim()) return null;
  const folder = path.resolve(expandHome(requested.trim()));
  if (!path.isAbsolute(folder) || folder === path.parse(folder).root || folder === os.homedir()) {
    return null;
  }
  let entries;
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch {
    return null; // a new folder the app will create, or one it can't open: nothing to add
  }
  const visible = entries
    .filter((entry) => !entry.name.startsWith('.') && !SKIPPED_NAMES.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (visible.length === 0) return 'The folder is empty: a new project.';

  const names = visible
    .slice(0, MAX_NAMES)
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
  const parts = [`Top level: ${names.join(', ')}${visible.length > MAX_NAMES ? ', …' : ''}`];
  const files = new Set(visible.filter((entry) => entry.isFile()).map((entry) => entry.name));
  let read = 0;
  for (const name of DESCRIBING_FILES) {
    if (read >= MAX_FILES) break;
    if (!files.has(name)) continue;
    try {
      const handle = await fs.open(
        path.join(folder, name),
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
      try {
        const buffer = Buffer.alloc(MAX_FILE_CHARS * 2);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const text = buffer.subarray(0, bytesRead).toString('utf8').slice(0, MAX_FILE_CHARS);
        parts.push(`${name}:\n${text}${bytesRead >= buffer.length ? '\n…' : ''}`);
        read++;
      } finally {
        await handle.close();
      }
    } catch {
      // unreadable: the names above still help
    }
  }
  return parts.join('\n\n');
}
