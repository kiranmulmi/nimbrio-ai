import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import nodePath from 'node:path';
import {
  APP_DATA_FOLDER,
  assertCanChange,
  isInAppData,
  findFilesByName,
  listWorkspaceFiles,
  resolveInWorkspace,
  searchFileContents,
} from '@app/agent';
import {
  LIMITS,
  type CreatedEntry,
  type FileContent,
  type FileCreate,
  type FileRename,
  type FileWrite,
  type FileSearchMode,
  type FileSearchResult,
  type WorkspaceFiles,
} from '@app/shared';
import {
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
} from '../../lib/errors.js';
import { runGit } from '../git/run-git.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';

/** Enough for most projects; past it, the deepest files are the ones left out (see walk.ts). */
const MAX_LISTED_FILES = 5_000;
/** Ignored paths reported (a fully ignored folder counts once): plenty for the tree. */
const MAX_IGNORED = 2_000;
const MAX_NAME_RESULTS = 200;
const MAX_CONTENT_MATCHES = 300;

/** A file's version: changes when its content does. */
const versionOf = (content: string) => createHash('sha1').update(content).digest('hex');

const APP_DATA_MESSAGE = `${APP_DATA_FOLDER}/ holds this app's own data, so it can't be used here.`;

/** The sandbox the agent's file tools use, as a 400 worded for the user. */
async function resolve(folder: string, requested: string): Promise<string> {
  try {
    return await resolveInWorkspace(folder, requested);
  } catch {
    throw new ValidationError(
      isInAppData(requested) ? APP_DATA_MESSAGE : 'Use a path inside the workspace folder.',
    );
  }
}

/**
 * For the user's own changes: inside the workspace, never the folder itself, .git or the
 * app's data (the same rules as the agent's file tools, worded for the person typing).
 */
async function resolveForChange(folder: string, requested: string): Promise<string> {
  const target = await resolve(folder, requested);
  try {
    await assertCanChange(folder, target);
  } catch {
    const isGit = nodePath
      .relative(await fs.realpath(folder), target)
      .split(nodePath.sep)
      .includes('.git');
    throw new ValidationError(
      isGit
        ? "Files inside .git can't be changed here."
        : 'Pick a name inside the workspace folder.',
    );
  }
  return target;
}

/**
 * An existing file or folder to rename or delete: its folder is resolved (inside the
 * workspace, symlinks followed), the entry itself is not, so a link is renamed or removed as
 * a link and never leads outside. Same rules as `resolveForChange`.
 */
async function entryAt(folder: string, requested: string): Promise<string> {
  const normal = nodePath.normalize(requested.replace(/\\/g, '/')).replace(/[\\/]+$/, '');
  const name = nodePath.basename(normal);
  if (!name || name === '.' || name === '..' || nodePath.isAbsolute(normal)) {
    throw new ValidationError('Use a path inside the workspace folder.');
  }
  if (isInAppData(name)) throw new ValidationError(APP_DATA_MESSAGE);
  const parent = await resolve(folder, nodePath.dirname(normal));
  const entry = nodePath.join(parent, name);
  try {
    await assertCanChange(folder, entry);
  } catch {
    throw new ValidationError("Files inside .git can't be changed here.");
  }
  if (!(await fs.lstat(entry).catch(() => null))) {
    throw new NotFoundError(`${requested} no longer exists. Refresh the list.`);
  }
  return entry;
}

/** The path as the Files panel shows it: relative to the workspace, "/" separators. */
async function relativeTo(folder: string, target: string): Promise<string> {
  const root = await fs.realpath(folder);
  return nodePath.relative(root, target).split(nodePath.sep).join('/');
}

/**
 * What git ignores in the folder, relative to it (files, and folders ending in "/" when all
 * inside is ignored). Empty when it isn't in a repository or git isn't there.
 */
async function ignoredPaths(folder: string): Promise<string[]> {
  const result = await runGit(
    folder,
    ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'],
    1_000_000,
  );
  if (!result || result.code !== 0) return [];
  return result.stdout
    .split('\0')
    .filter((entry) => entry && entry !== './')
    .slice(0, MAX_IGNORED);
}

export function createFilesService(workspaces: WorkspacesService) {
  return {
    async list(workspaceId: string): Promise<WorkspaceFiles> {
      const { path } = await workspaces.require(workspaceId);
      const isFolder = (await fs.stat(path).catch(() => null))?.isDirectory() ?? false;
      if (!isFolder) {
        return { path, files: [], emptyFolders: [], ignored: [], isTruncated: false };
      }
      const [listing, ignored] = await Promise.all([
        listWorkspaceFiles(path, MAX_LISTED_FILES),
        ignoredPaths(path),
      ]);
      return { path, ...listing, ignored };
    },

    /** File names, or lines inside files, that contain `query` (any case). */
    async search(
      workspaceId: string,
      query: string,
      mode: FileSearchMode,
    ): Promise<FileSearchResult> {
      const { path } = await workspaces.require(workspaceId);
      const empty: FileSearchResult = { query, mode, paths: [], files: [], isTruncated: false };
      const root = await fs.realpath(path).catch(() => null);
      if (!root) return empty;
      if (mode === 'names') {
        const { paths, isTruncated } = await findFilesByName(root, query, MAX_NAME_RESULTS);
        return { ...empty, paths, isTruncated };
      }
      const { files, isTruncated } = await searchFileContents(root, query, MAX_CONTENT_MATCHES);
      return { ...empty, files, isTruncated };
    },

    async read(workspaceId: string, requested: string): Promise<FileContent> {
      const { path } = await workspaces.require(workspaceId);
      const target = await resolve(path, requested);
      const stat = await fs.stat(target).catch(() => null);
      if (!stat?.isFile()) throw new NotFoundError('File not found.');
      if (stat.size > LIMITS.filePreviewBytes) {
        throw new PayloadTooLargeError('File is too large to preview.');
      }
      const content = await fs.readFile(target, 'utf8');
      return { path: requested, content, version: versionOf(content) };
    },

    /**
     * Saves a file edited by the user in the preview. With `baseVersion`, refuses when the file
     * changed on disk since it was opened (the agent or another editor), so nothing is lost.
     */
    async write(workspaceId: string, { path: requested, content, baseVersion }: FileWrite) {
      const { path } = await workspaces.require(workspaceId);
      const target = await resolveForChange(path, requested);
      const stat = await fs.stat(target).catch(() => null);
      if (!stat?.isFile()) throw new NotFoundError(`${requested} no longer exists.`);
      if (baseVersion !== undefined) {
        const onDisk = await fs.readFile(target, 'utf8');
        if (versionOf(onDisk) !== baseVersion) {
          throw new ConflictError(
            `${requested} changed on disk after you opened it. Reload it, or overwrite it with your version.`,
          );
        }
      }
      await fs.writeFile(target, content, 'utf8');
      const saved: FileContent = { path: requested, content, version: versionOf(content) };
      return saved;
    },

    /** A new empty file or folder, with any missing parent folders. */
    async create(
      workspaceId: string,
      { path: requested, kind }: FileCreate,
    ): Promise<CreatedEntry> {
      const { path } = await workspaces.require(workspaceId);
      const target = await resolveForChange(path, requested);
      if (await fs.lstat(target).catch(() => null)) {
        throw new ConflictError(`${requested} already exists.`);
      }
      await fs.mkdir(kind === 'folder' ? target : nodePath.dirname(target), { recursive: true });
      if (kind === 'file') {
        try {
          await fs.writeFile(target, '', { flag: 'wx' });
        } catch (error) {
          if ((error as { code?: unknown }).code === 'EEXIST') {
            throw new ConflictError(`${requested} already exists.`);
          }
          throw error;
        }
      }
      return { path: await relativeTo(path, target), kind };
    },

    /** Renames or moves a file or folder (any missing parent folders are made). */
    async rename(workspaceId: string, { from, to }: FileRename): Promise<CreatedEntry> {
      const { path } = await workspaces.require(workspaceId);
      const source = await entryAt(path, from);
      const kind = (await fs.lstat(source)).isDirectory() ? 'folder' : 'file';
      const resolved = await resolveForChange(path, to);
      // A name that differs only in case resolves to the file itself on a case-insensitive disk.
      const target =
        resolved === source
          ? nodePath.join(nodePath.dirname(source), nodePath.basename(to.trim()))
          : resolved;
      if (target === source) return { path: await relativeTo(path, source), kind };
      if (resolved !== source && (await fs.lstat(target).catch(() => null))) {
        throw new ConflictError(`${to} already exists.`);
      }
      if (target.startsWith(source + nodePath.sep)) {
        throw new ValidationError("A folder can't be moved into itself.");
      }
      await fs.mkdir(nodePath.dirname(target), { recursive: true });
      await fs.rename(source, target);
      return { path: await relativeTo(path, target), kind };
    },

    /** Deletes a file, or a folder with everything in it. Permanent: the web app asks first. */
    async remove(workspaceId: string, requested: string): Promise<void> {
      const { path } = await workspaces.require(workspaceId);
      const entry = await entryAt(path, requested);
      const stat = await fs.lstat(entry);
      if (stat.isDirectory()) await fs.rm(entry, { recursive: true });
      else await fs.unlink(entry);
    },
  };
}

export type FilesService = ReturnType<typeof createFilesService>;
