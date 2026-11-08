// MCP tools as agent tools: a name the model API accepts, the server's own input schema,
// approval unless the tool is in the server's autoApprove list, and results as text.
import { createHash } from 'node:crypto';
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import { isRecord } from '../errors.js';
import {
  APPROVAL_REASON,
  APPROVAL_REASON_PROPERTY,
  withoutReason,
  type AnyTool,
  type JsonObjectSchema,
} from '../tools/define.js';

export interface McpToolSource {
  server: string;
  tool: McpTool;
  /** tool names that run without asking first */
  autoApprove: readonly string[];
}

export type CallMcpTool = (
  server: string,
  tool: string,
  input: Record<string, unknown>,
) => Promise<unknown>;

const MAX_NAME = 64; // the limit OpenAI-compatible APIs put on function names
const MAX_DESCRIPTION = 2000;

/** "mcp__github__create_issue": the server in the name, so the model and the approval card show where it runs. */
export function agentToolName(server: string, tool: string): string {
  const clean = (part: string) => part.replace(/[^A-Za-z0-9_-]/g, '_');
  const name = `mcp__${clean(server)}__${clean(tool)}`;
  if (name.length <= MAX_NAME) return name;
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 6);
  return `${name.slice(0, MAX_NAME - 7)}_${hash}`;
}

export function toAgentTools(sources: readonly McpToolSource[], call: CallMcpTool): AnyTool[] {
  const used = new Set<string>();
  return sources.map(({ server, tool, autoApprove }) => {
    let name = agentToolName(server, tool.name);
    for (let n = 2; used.has(name); n += 1) name = agentToolName(server, `${tool.name}_${n}`);
    used.add(name);

    const needsApproval = !autoApprove.includes(tool.name);
    const schema = toParameters(tool.inputSchema);
    const required = Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === 'string')
      : [];
    // Like the built-in tools: a short reason for the user, unless the server uses the name.
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const addsReason = needsApproval && !(APPROVAL_REASON in properties);
    const parameters: JsonObjectSchema = addsReason
      ? { ...schema, properties: { ...properties, [APPROVAL_REASON]: APPROVAL_REASON_PROPERTY } }
      : schema;

    return {
      name,
      needsApproval,
      definition: {
        type: 'function',
        function: { name, description: describe(server, tool), parameters },
      },
      // The server checks its own input in full; this catches what the model can fix itself.
      validate(input) {
        if (!isRecord(input)) return 'Arguments must be a JSON object.';
        const missing = required.find((key) => !(key in input));
        return missing ? `Missing required argument "${missing}".` : null;
      },
      async runValidated(input) {
        const args = addsReason ? withoutReason(input) : input;
        return formatResult(await call(server, tool.name, isRecord(args) ? args : {}));
      },
    };
  });
}

function describe(server: string, tool: McpTool): string {
  const text = (tool.description ?? tool.title ?? tool.name).trim();
  const full = `${text} (From the "${server}" MCP server.)`;
  return full.length > MAX_DESCRIPTION ? `${full.slice(0, MAX_DESCRIPTION - 1)}…` : full;
}

function toParameters(schema: McpTool['inputSchema']): JsonObjectSchema {
  const { $schema: _ignored, ...rest } = schema as Record<string, unknown>;
  return { ...rest, type: 'object', properties: isRecord(rest.properties) ? rest.properties : {} };
}

/** A tool result as text for the model. A result the server flags as an error throws. */
export function formatResult(result: unknown): string {
  if (!isRecord(result)) return JSON.stringify(result ?? null);
  const blocks = Array.isArray(result.content) ? result.content : [];
  const parts = blocks.map(describeBlock).filter((part) => part !== '');
  if (!parts.length && result.structuredContent !== undefined) {
    parts.push(JSON.stringify(result.structuredContent, null, 2));
  }
  if (!parts.length && 'toolResult' in result) {
    parts.push(JSON.stringify(result.toolResult, null, 2));
  }
  const text = parts.join('\n\n') || '(The tool returned nothing.)';
  if (result.isError === true) throw new Error(text);
  return text;
}

function describeBlock(block: unknown): string {
  if (!isRecord(block)) return '';
  switch (block.type) {
    case 'text':
      return typeof block.text === 'string' ? block.text : '';
    case 'image':
    case 'audio':
      return `[${block.type} (${String(block.mimeType ?? 'unknown type')}) not shown]`;
    case 'resource': {
      const resource = isRecord(block.resource) ? block.resource : {};
      return typeof resource.text === 'string'
        ? resource.text
        : `[resource ${String(resource.uri ?? '')}]`;
    }
    case 'resource_link':
      return `[${String(block.name ?? 'link')}: ${String(block.uri ?? '')}]`;
    default:
      return '';
  }
}
