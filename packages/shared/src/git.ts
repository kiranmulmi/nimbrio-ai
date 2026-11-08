import { z } from 'zod';
import { LIMITS } from './limits.js';

/** How a file differs from the last commit (staged and unstaged changes together). */
export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'conflicted';

export interface GitChangedFile {
  /** relative to the repository's top folder, with forward slashes */
  path: string;
  status: GitFileStatus;
  /** some of its changes are staged (`git add`) */
  isStaged: boolean;
  /** some of its changes are not staged yet */
  isUnstaged: boolean;
  /** changed lines; null for binary files and for new files git doesn't track yet */
  additions: number | null;
  deletions: number | null;
}

/** GET /v1/workspaces/:id/git: what changed in the workspace's folder since the last commit. */
export interface GitChanges {
  /** false when the folder isn't inside a git repository (or git isn't installed) */
  isRepo: boolean;
  /** the current branch; null when detached or not a repository */
  branch: string | null;
  /** the repository's top folder (absolute), null when not a repository */
  root: string | null;
  /** only the changes inside the workspace folder, sorted by path */
  files: GitChangedFile[];
  /** true when there were more changed files than listed */
  isTruncated: boolean;
}

/** GET /v1/workspaces/:id/git/diff?path=: one changed file's unified diff. */
export interface GitFileDiff {
  path: string;
  /** `git diff` output (unified, no colour); empty for a binary file */
  diff: string;
  isBinary: boolean;
  /** the diff was longer than the API sends */
  isTruncated: boolean;
}

export const gitDiffQuerySchema = z.object({
  path: z.string().min(1, 'Say which file.').max(LIMITS.folderPath),
});
