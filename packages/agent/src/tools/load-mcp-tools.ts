import { defineTool } from './define.js';

export const LOAD_MCP_TOOLS = 'load_mcp_tools';

/**
 * MCP tools are listed to the model by name only (their full definitions are large); this
 * adds the ones a task needs to the tools it can call, for the rest of the request.
 */
export const loadMcpTools = defineTool<{ names: string[] }>({
  name: LOAD_MCP_TOOLS,
  description:
    'Make MCP tools callable. The MCP tools under "MCP tools you can load" are listed by name only; call this with the names a task needs before using them, then call them as usual. A name ending in * loads every tool that starts with it, e.g. "mcp__jira__*". Load only what the task needs: each loaded tool is sent with every later step.',
  properties: {
    names: {
      type: 'array',
      items: { type: 'string' },
      description: 'Tool names exactly as listed, e.g. ["mcp__jira__getJiraIssue"].',
    },
  },
  async run({ names }, ctx) {
    if (!ctx.loadTools) throw new Error('There are no MCP tools to load in this workspace.');
    const wanted = names.map((name) => name.trim()).filter(Boolean);
    if (!wanted.length) throw new Error('Name at least one tool to load.');
    const { loaded, already, unknown } = ctx.loadTools(wanted);
    const lines = [
      loaded.length ? `Loaded: ${loaded.join(', ')}. You can call them now.` : '',
      already.length ? `Already loaded: ${already.join(', ')}.` : '',
      unknown.length
        ? `Not found: ${unknown.join(', ')}. Use names exactly as listed under "MCP tools you can load".`
        : '',
    ].filter(Boolean);
    if (!loaded.length && !already.length) throw new Error(lines.join('\n'));
    return lines.join('\n');
  },
});
