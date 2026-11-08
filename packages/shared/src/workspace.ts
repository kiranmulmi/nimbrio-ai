import { z } from 'zod';
import { LIMITS } from './limits.js';

/**
 * Groups of built-in tools a workspace can turn off (a chat-only workspace doesn't need file
 * or command tools). Off, their definitions and the matching system prompt rules aren't sent,
 * which makes every model call smaller. The clock and calculator are always on; attachment
 * tools come with attached files, skills and MCP tools with the workspace's own.
 */
export const TOOL_GROUPS = ['files', 'commands', 'web', 'memory', 'plans'] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

export const TOOL_GROUP_LABELS: Record<ToolGroup, { label: string; detail: string }> = {
  files: { label: 'Files', detail: 'Read, search, write, move and delete files in the folder' },
  commands: { label: 'Commands', detail: 'Run shell commands: tests, builds, installs, git' },
  web: { label: 'Web', detail: 'Search the web and read pages' },
  memory: { label: 'Memory', detail: 'Save, look up and forget lasting facts' },
  plans: { label: 'Plans', detail: 'Write and track a step-by-step plan for bigger tasks' },
};

/**
 * The planning step before each message: `default` follows Settings → Agent; `auto` and
 * `off` override it for this workspace. Off saves one model call per message.
 */
export const WORKSPACE_PLANNING = ['default', 'auto', 'off'] as const;
export type WorkspacePlanning = (typeof WORKSPACE_PLANNING)[number];

export interface Workspace {
  id: string;
  name: string;
  instructions: string;
  /** The absolute folder on the user's machine the file tools work in. */
  path: string;
  planning: WorkspacePlanning;
  /** Tool groups turned off here (empty: all on). */
  disabledTools: ToolGroup[];
  /** Chat by voice: the web app talks and listens instead of showing the message box. */
  voiceMode: boolean;
  /** Show the side panel's Terminal tab (off by default). */
  hasTerminalTab: boolean;
  /** Show the side panel's Git diff tab (off by default). */
  hasGitTab: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  chatCount?: number;
  /** In the list: when a chat here last changed, else when the workspace did. */
  lastActiveAt?: string | null;
}

export interface WorkspaceDeletion {
  /** Files are never deleted with a workspace; this is where they stay. */
  filesKeptAt: string;
}

const name = z
  .string()
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'Give the workspace a name.')
      .max(LIMITS.workspaceName, `Keep the name under ${LIMITS.workspaceName} characters.`),
  );

// The API resolves "~", checks the folder and creates it if missing; this only
// catches what's wrong before a request is sent (the browser has no path module).
const folderPath = z
  .string()
  .trim()
  .min(1, 'Choose a folder for the workspace.')
  .max(LIMITS.folderPath, `Keep the path under ${LIMITS.folderPath} characters.`)
  .regex(/^(~(\/|$)|\/|[A-Za-z]:[\\/])/, 'Use an absolute path, like /Users/you/projects/app.');

const instructions = z
  .string()
  .trim()
  .max(LIMITS.instructions, `Keep instructions under ${LIMITS.instructions} characters.`);

const planning = z.enum(WORKSPACE_PLANNING);
const disabledTools = z.array(z.enum(TOOL_GROUPS)).transform((groups) => [...new Set(groups)]);

export const workspaceInputSchema = z.object({
  name,
  path: folderPath,
  instructions: instructions.default(''),
  planning: planning.default('default'),
  disabledTools: disabledTools.default([]),
  voiceMode: z.boolean().default(false),
  hasTerminalTab: z.boolean().default(false),
  hasGitTab: z.boolean().default(false),
});

export const workspaceUpdateSchema = z.object({
  name: name.optional(),
  path: folderPath.optional(),
  instructions: instructions.optional(),
  planning: planning.optional(),
  disabledTools: disabledTools.optional(),
  voiceMode: z.boolean().optional(),
  hasTerminalTab: z.boolean().optional(),
  hasGitTab: z.boolean().optional(),
});

export type WorkspaceInput = z.input<typeof workspaceInputSchema>;
export type WorkspaceUpdate = z.input<typeof workspaceUpdateSchema>;
