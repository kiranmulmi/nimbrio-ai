// The list of workspaces (id, name, folder), in ~/.nimbrio-ai/workspaces.json. Everything
// else about a workspace lives in its own folder (workspace-data.ts).
import { randomUUID } from 'node:crypto';
import { serialized } from '@app/agent';
import { z } from 'zod';
import { InputError } from './errors.js';
import { readJson, writePrivateJson } from './json-file.js';
import { isUuid } from './workspace-data.js';

const savedWorkspaceSchema = z.object({
  id: z.string().refine(isUuid, 'must be a UUID'),
  name: z.string().min(1),
  /** Absolute, real path of the folder. */
  path: z.string().min(1),
  createdAt: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
});

export type SavedWorkspace = z.output<typeof savedWorkspaceSchema>;

const workspacesFileSchema = z.object({
  workspaces: z.array(savedWorkspaceSchema).default([]),
});

export class WorkspaceList {
  constructor(readonly file: string) {}

  /** Oldest first. */
  async list(): Promise<SavedWorkspace[]> {
    const raw = await readJson(this.file);
    if (raw === null) return [];
    const parsed = workspacesFileSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `${this.file} is damaged: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim(),
      );
    }
    return parsed.data.workspaces;
  }

  async get(id: string): Promise<SavedWorkspace | null> {
    if (!isUuid(id)) return null;
    return (await this.list()).find((w) => w.id === id) ?? null;
  }

  /** `path` must be a folder no other workspace uses. */
  async add(name: string, path: string): Promise<SavedWorkspace> {
    return this.#change((workspaces) => {
      assertFolderFree(workspaces, path);
      const now = new Date().toISOString();
      const added = { id: randomUUID(), name, path, createdAt: now, updatedAt: now };
      return { workspaces: [...workspaces, added], result: added };
    });
  }

  async update(
    id: string,
    changes: { name: string; path: string },
  ): Promise<SavedWorkspace | null> {
    return this.#change((workspaces) => {
      const current = workspaces.find((w) => w.id === id);
      if (!current) return { workspaces, result: null };
      assertFolderFree(workspaces, changes.path, id);
      const updated = { ...current, ...changes, updatedAt: new Date().toISOString() };
      return {
        workspaces: workspaces.map((w) => (w.id === id ? updated : w)),
        result: updated,
      };
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.#change((workspaces) => {
      const left = workspaces.filter((w) => w.id !== id);
      const isRemoved = left.length < workspaces.length;
      return { workspaces: isRemoved ? left : workspaces, result: isRemoved };
    });
  }

  /** Throws when another workspace than `exceptId` already uses `path`. */
  async assertFolderFree(path: string, exceptId?: string): Promise<void> {
    assertFolderFree(await this.list(), path, exceptId);
  }

  /** Read, change and write the file as one step, so concurrent changes can't lose each other. */
  #change<T>(
    update: (workspaces: SavedWorkspace[]) => { workspaces: SavedWorkspace[]; result: T },
  ): Promise<T> {
    return serialized(this.file, async () => {
      const before = await this.list();
      const { workspaces, result } = update(before);
      if (workspaces !== before) await writePrivateJson(this.file, { workspaces });
      return result;
    });
  }
}

function assertFolderFree(workspaces: SavedWorkspace[], path: string, exceptId?: string): void {
  const owner = workspaces.find((w) => w.path === path && w.id !== exceptId);
  if (owner) throw new InputError(`The workspace "${owner.name}" already uses that folder.`);
}
