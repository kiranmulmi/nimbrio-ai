// A workspace's skills, one Markdown file each:
//
//   <folder>/.nimbrio-ai/skills/<name>.md
//
//   ---
//   name: jira-ticket-fix
//   description: When the user gives a Jira ticket to check or fix.
//   ---
//
//   The instructions…
//
// The file name is the skill's name (the `name:` line is written for readers and other
// tools, and ignored when it disagrees). Written from the Skills tab; the agent reads them
// through the SkillStore interface, and its file tools can't reach .nimbrio-ai/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { SKILL_LIMITS, SKILL_NAME_PATTERN, type Skill, type SkillInput } from '@app/shared';
import {
  APP_DATA_FOLDER,
  errorCode,
  serialized,
  writeFileAtomic,
  type SkillStore,
} from '@app/agent';
import { InputError } from './errors.js';
import { WorkspaceData } from './workspace-data.js';

/** A skill file is read only up to this size: anything longer can't be a valid skill. */
const MAX_FILE_BYTES = 256 * 1024;

/** The name is taken by another skill (the API answers 409). */
export class SkillExistsError extends Error {
  override name = 'SkillExistsError';
}

export class WorkspaceSkills implements SkillStore {
  /** <folder>/.nimbrio-ai/skills */
  readonly dir: string;

  constructor(readonly folder: string) {
    this.dir = path.join(folder, APP_DATA_FOLDER, 'skills');
  }

  async list(): Promise<Skill[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }
    const skills = await Promise.all(
      names
        .filter((file) => file.endsWith('.md'))
        .map((file) => file.slice(0, -'.md'.length))
        .filter((name) => SKILL_NAME_PATTERN.test(name))
        .map((name) => this.get(name)),
    );
    return skills
      .filter((skill): skill is Skill => skill !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, SKILL_LIMITS.count);
  }

  async get(name: string): Promise<Skill | null> {
    const file = this.#file(name);
    if (!file) return null;
    try {
      const handle = await fs.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
        const text = await handle.readFile('utf8');
        return { name, ...parseSkillFile(text), updatedAt: info.mtime.toISOString() };
      } finally {
        await handle.close();
      }
    } catch (error) {
      // Missing, or a link (O_NOFOLLOW): not a skill.
      if (['ENOENT', 'ELOOP', 'EMLINK'].includes(errorCode(error) ?? '')) return null;
      throw error;
    }
  }

  /** Throws SkillExistsError when the name is taken. */
  async create(input: SkillInput): Promise<Skill> {
    return serialized(this.dir, async () => {
      if (await this.get(input.name)) throw this.#taken(input.name);
      if ((await this.list()).length >= SKILL_LIMITS.count) {
        throw new InputError(`A workspace can have at most ${SKILL_LIMITS.count} skills.`);
      }
      await this.#write(input, 'wx');
      return this.#require(input.name);
    });
  }

  /** Saves `name` as `input` (a different `input.name` renames it). Null when it's gone. */
  async update(name: string, input: SkillInput): Promise<Skill | null> {
    return serialized(this.dir, async () => {
      if (!(await this.get(name))) return null;
      const isRename = input.name !== name;
      if (isRename && (await this.get(input.name))) throw this.#taken(input.name);
      await this.#write(input, isRename ? 'wx' : 'w');
      if (isRename) await this.remove(name);
      return this.#require(input.name);
    });
  }

  /** False when there was no such skill. */
  async remove(name: string): Promise<boolean> {
    const file = this.#file(name);
    if (!file) return false;
    try {
      await fs.unlink(file);
      return true;
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return false;
      throw error;
    }
  }

  /** Only a valid name maps to a file, so a name can never reach outside the folder. */
  #file(name: string): string | null {
    return SKILL_NAME_PATTERN.test(name) && name.length <= SKILL_LIMITS.nameLength
      ? path.join(this.dir, `${name}.md`)
      : null;
  }

  async #write(input: SkillInput, flag: 'w' | 'wx'): Promise<void> {
    await new WorkspaceData(this.folder).ensure(); // the data folder and its .gitignore
    await fs.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${input.name}.md`);
    const text = formatSkillFile(input);
    if (flag === 'wx') await fs.writeFile(file, text, { flag: 'wx' });
    else await writeFileAtomic(file, text);
  }

  async #require(name: string): Promise<Skill> {
    const skill = await this.get(name);
    if (!skill) throw new Error(`The skill "${name}" couldn't be read back after saving.`);
    return skill;
  }

  #taken(name: string): SkillExistsError {
    return new SkillExistsError(`A skill called "${name}" already exists. Pick another name.`);
  }
}

/** The file's text: front matter with the name and a one-line description, then the body. */
export function formatSkillFile({ name, description, body }: SkillInput): string {
  const line = description.replace(/\s+/g, ' ').trim();
  return `---\nname: ${name}\ndescription: ${line}\n---\n\n${body.trim()}\n`;
}

/** Reads a skill file; one without front matter is all body, with no description. */
export function parseSkillFile(text: string): Pick<Skill, 'description' | 'body'> {
  const normalized = text.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!match) return { description: '', body: normalized.trim() };
  const [, head = '', body = ''] = match;
  const description = /^description:[ \t]*(.*)$/m.exec(head)?.[1]?.trim() ?? '';
  return { description: unquote(description), body: body.trim() };
}

/** `"text"` or `'text'` as written by hand in YAML. */
function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted ? (quoted[2] ?? '') : value;
}
