// Tool registry. To add a tool: create it with defineTool() in this folder and
// add it to TOOLS. Keep the order fixed so servers that cache prompt prefixes can reuse them.
import type { ToolGroup } from '@app/shared';
import type { AnyTool, ToolDefinition } from './define.js';
import { getCurrentTime } from './time.js';
import { calculator } from './calculator.js';
import { listFiles } from './files/list-files.js';
import { readFile } from './files/read-file.js';
import { findFiles } from './files/find-files.js';
import { searchFiles } from './files/search-files.js';
import { writeFile } from './files/write-file.js';
import { editFile } from './files/edit-file.js';
import { createFolder } from './files/create-folder.js';
import { movePath } from './files/move-path.js';
import { copyPath } from './files/copy-path.js';
import { deletePath } from './files/delete-path.js';
import { readAttachment, saveAttachment, viewImage } from './attachments.js';
import { runCommand } from './run-command.js';
import { stopTask, taskOutput } from './tasks.js';
import { remember, recall, forget } from './memory.js';
import { createPlan, updatePlan, addPlanSteps } from './plan.js';
import { webSearch } from './web-search.js';
import { useSkill } from './skills.js';
import { loadMcpTools } from './load-mcp-tools.js';
import { fetchPage } from './fetch-page.js';

const TOOLS: readonly AnyTool[] = [
  createPlan,
  updatePlan,
  addPlanSteps,
  useSkill,
  getCurrentTime,
  calculator,
  webSearch,
  fetchPage,
  listFiles,
  readFile,
  findFiles,
  searchFiles,
  writeFile,
  editFile,
  createFolder,
  movePath,
  copyPath,
  deletePath,
  readAttachment,
  viewImage,
  saveAttachment,
  runCommand,
  taskOutput,
  stopTask,
  remember,
  recall,
  forget,
];

/** Which group each built-in tool belongs to (a workspace can turn groups off). */
const GROUP_OF: Record<string, ToolGroup> = {
  [listFiles.name]: 'files',
  [readFile.name]: 'files',
  [findFiles.name]: 'files',
  [searchFiles.name]: 'files',
  [writeFile.name]: 'files',
  [editFile.name]: 'files',
  [createFolder.name]: 'files',
  [movePath.name]: 'files',
  [copyPath.name]: 'files',
  [deletePath.name]: 'files',
  [saveAttachment.name]: 'files', // it writes into the folder
  [runCommand.name]: 'commands',
  [taskOutput.name]: 'commands',
  [stopTask.name]: 'commands',
  [webSearch.name]: 'web',
  [fetchPage.name]: 'web',
  [remember.name]: 'memory',
  [recall.name]: 'memory',
  [forget.name]: 'memory',
  [createPlan.name]: 'plans',
  [updatePlan.name]: 'plans',
  [addPlanSteps.name]: 'plans',
};

/** Tools sent only when a request needs them: attached files, or the workspace's skills. */
export const ATTACHMENT_TOOLS: readonly string[] = [
  readAttachment.name,
  viewImage.name,
  saveAttachment.name,
];
export const SKILL_TOOLS: readonly string[] = [useSkill.name];

export interface Toolset {
  byName: Map<string, AnyTool>;
  /**
   * The definitions sent to the model: the always-on tools, plus those in `active` (MCP tools
   * the model loaded, attachment and skill tools when needed, tools the chat already called).
   */
  definitionsFor(active: ReadonlySet<string>): ToolDefinition[];
  /** The MCP tools, sent only once loaded (load_mcp_tools): their full definitions are large. */
  deferred: ReadonlySet<string>;
  /** Tools in a group the workspace turned off: they refuse to run. */
  disabled: ReadonlySet<string>;
  /** One line per usable tool, for the planner prompt. */
  summary: string;
  /** One line per MCP tool, for the system prompt; empty when there are none. */
  deferredSummary: string;
}

/** A tool's description cut to its first sentence, for the one-line lists. */
function firstSentence(tool: AnyTool, max = 160): string {
  const text = (tool.definition.function.description.split(/\.\s/)[0] ?? '').replace(/\s+/g, ' ');
  const line = text.replace(/\.$/, '');
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : `${line}.`;
}

/**
 * The built-in tools, then `extra` ones (from MCP servers). The extra ones are deferred: the
 * model sees their names (`deferredSummary`) and loads the ones it needs with load_mcp_tools.
 * Tools in `disabledGroups` are left out (unless a chat already called one: see `disabled`).
 */
export function buildToolset(
  extra: readonly AnyTool[] = [],
  disabledGroups: readonly ToolGroup[] = [],
): Toolset {
  const mcp = extra.filter((tool) => !TOOLS.some((t) => t.name === tool.name));
  const builtIn = mcp.length ? [...TOOLS, loadMcpTools] : [...TOOLS];
  const tools = [...builtIn, ...mcp];
  const isOff = (t: AnyTool) => {
    const group = GROUP_OF[t.name];
    return group !== undefined && disabledGroups.includes(group);
  };
  const onDemand = new Set([...ATTACHMENT_TOOLS, ...SKILL_TOOLS, ...mcp.map((t) => t.name)]);
  const usable = tools.filter((t) => !isOff(t));
  const line = (t: AnyTool) => `- ${t.name}: ${firstSentence(t)}`;
  return {
    byName: new Map(tools.map((t) => [t.name, t])),
    definitionsFor: (active) =>
      // In a fixed order, so the list (and what servers can cache) stays stable.
      tools
        .filter((t) => active.has(t.name) || (!onDemand.has(t.name) && !isOff(t)))
        .map((t) => t.definition),
    deferred: new Set(mcp.map((t) => t.name)),
    disabled: new Set(tools.filter(isOff).map((t) => t.name)),
    summary: usable.map(line).join('\n'),
    deferredSummary: mcp.map(line).join('\n'),
  };
}
