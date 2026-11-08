import { z } from 'zod';
import { LIMITS } from './limits.js';

export interface WorkspaceFiles {
  /** The workspace folder (absolute). */
  path: string;
  /** Paths relative to the workspace folder, without generated folders like node_modules. */
  files: string[];
  /** folders with nothing in them, so a new folder shows in the tree */
  emptyFolders: string[];
  /**
   * What git ignores here (.gitignore and the like), for dimming: files, and folders ending in
   * "/" whose whole contents are ignored. Empty outside a git repository.
   */
  ignored: string[];
  /** true when there were more files than the listing shows */
  isTruncated: boolean;
}

export interface FileContent {
  path: string;
  content: string;
  /** a hash of the content: a save sends it back, so changes made meanwhile aren't overwritten */
  version: string;
}

/** Largest file the editor saves (characters); the preview opens files up to 200 KB. */
export const FILE_EDIT_MAX_CHARS = 400_000;

/** PUT /v1/workspaces/:id/files/content: save a file edited in the preview. */
export const fileWriteSchema = z.object({
  path: z.string().min(1, 'Say which file.').max(LIMITS.folderPath),
  content: z.string().max(FILE_EDIT_MAX_CHARS, 'The file is too large to save from here.'),
  /** the version the edit started from; left out: overwrite whatever is there */
  baseVersion: z.string().max(100).optional(),
});

export type FileWrite = z.infer<typeof fileWriteSchema>;

export const FILE_ENTRY_KINDS = ['file', 'folder'] as const;
export type FileEntryKind = (typeof FILE_ENTRY_KINDS)[number];

/** POST /v1/workspaces/:id/files: a new empty file or folder (parent folders made too). */
export const fileCreateSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1, 'Type a name.')
    .max(LIMITS.folderPath)
    .refine((value) => !/[\\/]$/.test(value), 'Leave out the trailing slash.'),
  kind: z.enum(FILE_ENTRY_KINDS),
});

export type FileCreate = z.infer<typeof fileCreateSchema>;

const entryPath = z.string().trim().min(1, 'Say which file or folder.').max(LIMITS.folderPath);

/** PATCH /v1/workspaces/:id/files: rename or move a file or folder. */
export const fileRenameSchema = z.object({
  from: entryPath,
  to: entryPath.refine((value) => !/[\\/]$/.test(value), 'Leave out the trailing slash.'),
});

export type FileRename = z.infer<typeof fileRenameSchema>;

/** DELETE /v1/workspaces/:id/files?path=: a file, or a folder and everything in it. */
export const fileDeleteQuerySchema = z.object({ path: entryPath });

export interface CreatedEntry {
  /** relative to the workspace folder, with "/" separators */
  path: string;
  kind: FileEntryKind;
}

export const fileContentQuerySchema = z.object({
  path: z.string().min(1, 'Say which file to open.'),
});

/** One level of the folder browser used to choose a workspace's location. */
export interface FolderListing {
  /** absolute */
  path: string;
  /** null at the filesystem root */
  parent: string | null;
  /** the user's home folder, where browsing starts */
  home: string;
  /** names of the subfolders, sorted, hidden ones left out */
  folders: string[];
}

export const folderQuerySchema = z.object({
  /** absolute, or "~/..."; empty or missing means the home folder */
  path: z.string().max(LIMITS.folderPath).optional(),
});

/** GET /v1/folders/check: can this folder be the workspace's (`workspaceId`), or a new one's? */
export const folderCheckQuerySchema = z.object({
  path: z.string().max(LIMITS.folderPath),
  /** the workspace being edited; missing for a new workspace */
  workspaceId: z.string().uuid().optional(),
});

export interface FolderCheck {
  /** why the folder can't be used (e.g. another workspace uses it), or null; nothing is created */
  problem: string | null;
}

const LIMITS_FOLDER_PATH = 1024;

/** POST /v1/folders/pick: opens the system's folder dialog on this machine. */
export const folderPickSchema = z.object({
  /** where the dialog starts (a missing folder starts it at home) */
  startAt: z.string().max(LIMITS_FOLDER_PATH).optional(),
});

export interface FolderPick {
  /** the chosen folder, or null when the dialog was cancelled */
  path: string | null;
  /** false: no system dialog here (e.g. Linux without zenity), so use the in-app picker */
  isSupported: boolean;
}

export const FILE_SEARCH_MODES = ['names', 'contents'] as const;
export type FileSearchMode = (typeof FILE_SEARCH_MODES)[number];

/** GET /v1/workspaces/:id/files/search?q=&mode=: the Files panel's search. */
export const fileSearchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Type something to search for.').max(200, 'Search for less.'),
  mode: z.enum(FILE_SEARCH_MODES).default('names'),
});

/** One file's lines that contain the search text. */
export interface FileContentMatch {
  path: string;
  lines: { line: number; text: string }[];
  /** more matching lines in this file than are listed */
  moreLines: number;
}

export interface FileSearchResult {
  query: string;
  mode: FileSearchMode;
  /** names mode: matching file paths, relative to the workspace folder */
  paths: string[];
  /** contents mode: the matching lines, file by file */
  files: FileContentMatch[];
  /** stopped early: too many results, too many files, or out of time */
  isTruncated: boolean;
}
