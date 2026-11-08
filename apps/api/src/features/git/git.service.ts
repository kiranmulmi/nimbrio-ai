import type { GitChangedFile, GitChanges, GitFileDiff, GitFileStatus } from '@app/shared';
import { NotFoundError } from '../../lib/errors.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';
import { runGit } from './run-git.js';

/** git's empty tree: the base to diff against in a repository with no commit yet. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MAX_FILES = 500;
const MAX_DIFF_BYTES = 400_000;

const DIFF_ARGS = ['--no-color', '--no-ext-diff', '--no-textconv', '--no-renames'];

/** One `git status --porcelain` entry's two letters (staged, unstaged) as one status. */
function statusOf(staged: string, unstaged: string): GitFileStatus {
  if (staged === '?' && unstaged === '?') return 'untracked';
  if (staged === 'U' || unstaged === 'U' || (staged === unstaged && 'AD'.includes(staged))) {
    return 'conflicted';
  }
  if (staged === 'D' || unstaged === 'D') return 'deleted';
  if (staged === 'A') return 'added';
  return 'modified';
}

/** `git diff --numstat -z`: lines added and removed per path (null for binary files). */
function parseNumstat(
  output: string,
): Map<string, { additions: number | null; deletions: number | null }> {
  const counts = new Map<string, { additions: number | null; deletions: number | null }>();
  for (const entry of output.split('\0')) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(entry);
    if (!match?.[3]) continue;
    counts.set(match[3], {
      additions: match[1] === '-' ? null : Number(match[1]),
      deletions: match[2] === '-' ? null : Number(match[2]),
    });
  }
  return counts;
}

/** Cuts at the last whole line, so a long diff ends cleanly. */
const toLastLine = (text: string) => text.slice(0, Math.max(0, text.lastIndexOf('\n') + 1));

export function createGitService(workspaces: WorkspacesService) {
  /** The repository around the workspace folder, or null when there is none. */
  async function repoOf(folder: string) {
    const top = await runGit(folder, ['rev-parse', '--show-toplevel']);
    if (!top || top.code !== 0) return null;
    const root = top.stdout.trim();
    const [branch, head] = await Promise.all([
      runGit(folder, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
      runGit(folder, ['rev-parse', '--verify', '--quiet', 'HEAD']),
    ]);
    return {
      root,
      branch: branch?.code === 0 ? branch.stdout.trim() || null : null,
      base: head?.code === 0 ? 'HEAD' : EMPTY_TREE,
    };
  }

  async function changesIn(folder: string): Promise<GitChanges & { base: string }> {
    const repo = await repoOf(folder);
    if (!repo) {
      return { isRepo: false, branch: null, root: null, files: [], isTruncated: false, base: '' };
    }
    // Paths come back relative to the repository's top; `-- .` keeps them to this folder.
    const [status, numstat] = await Promise.all([
      runGit(folder, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--no-renames',
        '--',
        '.',
      ]),
      runGit(folder, ['diff', repo.base, '--numstat', '-z', ...DIFF_ARGS, '--', '.']),
    ]);
    const counts = parseNumstat(numstat?.stdout ?? '');
    const files: GitChangedFile[] = [];
    for (const entry of (status?.stdout ?? '').split('\0')) {
      if (entry.length < 4) continue;
      const staged = entry.charAt(0);
      const unstaged = entry.charAt(1);
      const path = entry.slice(3);
      const fileStatus = statusOf(staged, unstaged);
      const count = counts.get(path);
      files.push({
        path,
        status: fileStatus,
        isStaged: !' ?'.includes(staged),
        isUnstaged: fileStatus === 'untracked' || !' ?'.includes(unstaged),
        additions: count?.additions ?? null,
        deletions: count?.deletions ?? null,
      });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return {
      isRepo: true,
      branch: repo.branch,
      root: repo.root,
      files: files.slice(0, MAX_FILES),
      isTruncated: files.length > MAX_FILES || Boolean(status?.isTruncated),
      base: repo.base,
    };
  }

  return {
    async changes(workspaceId: string): Promise<GitChanges> {
      const { path } = await workspaces.require(workspaceId);
      const { base: _base, ...changes } = await changesIn(path);
      return changes;
    },

    /** Only a file `git status` lists here can be diffed, so the path is never free-form. */
    async diff(workspaceId: string, requested: string): Promise<GitFileDiff> {
      const { path } = await workspaces.require(workspaceId);
      const changes = await changesIn(path);
      const file = changes.files.find((item) => item.path === requested);
      if (!changes.root || !file) {
        throw new NotFoundError(`${requested} has no changes to show. Refresh the list.`);
      }
      const args =
        file.status === 'untracked'
          ? ['diff', '--no-index', ...DIFF_ARGS, '--', '/dev/null', file.path]
          : ['diff', changes.base, ...DIFF_ARGS, '--', `:(literal)${file.path}`];
      const result = await runGit(changes.root, args, MAX_DIFF_BYTES);
      const output = result?.stdout ?? '';
      const isBinary = !output.includes('\n@@') && /^Binary files .* differ$/m.test(output);
      return {
        path: file.path,
        diff: isBinary ? '' : result?.isTruncated ? toLastLine(output) : output,
        isBinary,
        isTruncated: Boolean(result?.isTruncated),
      };
    },
  };
}

export type GitService = ReturnType<typeof createGitService>;
