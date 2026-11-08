import type { SkillStore } from '../skills.js';
import type { Planner } from '../planner.js';
import type { AttachmentStore } from '../attachments.js';
import type { MemoryStore } from '../memory/long-term.js';
import type { WorkspaceTasks } from '../background-tasks.js';

/** What a tool can reach while it runs. */
/** What load_mcp_tools did with the names it was given. */
export interface McpToolsLoaded {
  loaded: string[];
  already: string[];
  unknown: string[];
}

export interface ToolContext {
  planner: Planner;
  longTermMemory: MemoryStore;
  /** the workspace folder: the only place the file tools may use */
  workspace: string;
  searxngUrl: string;
  /** the files the user attached in this workspace's chats; null when the app keeps none */
  attachments: AttachmentStore | null;
  /** the workspace's skills (use_skill); null when the app keeps none */
  skills: SkillStore | null;
  /**
   * load_mcp_tools: make these deferred MCP tools callable for the rest of the request
   * (names, or a prefix ending in *). Null when the workspace has no MCP tools.
   */
  loadTools: ((names: readonly string[]) => McpToolsLoaded) | null;
  /** the workspace's background tasks (run_command background, task_output, stop_task); null when the app keeps none */
  tasks: WorkspaceTasks | null;
  /** view_image: show this attached image to the model with the next message */
  showImage: (attachmentId: string) => void;
  /** aborted when the user stops the run: long tools (run_command) stop early */
  signal?: AbortSignal;
}

/**
 * Tools that ask the user first take one more argument: why the step is needed, in a short
 * sentence the user reads when deciding. The tool itself never sees it.
 */
export const APPROVAL_REASON = 'reason';

export const APPROVAL_REASON_PROPERTY: PropertySchema = {
  type: 'string',
  description:
    'Why you need this step now, in one short plain sentence for the user, who reads it when deciding whether to allow it. Say what it achieves, e.g. "Run the tests to check the fix works."',
};

/** The input without the approval reason (only the agent loop and the user see it). */
export function withoutReason(input: unknown): unknown {
  if (!isObject(input) || !(APPROVAL_REASON in input)) return input;
  const { [APPROVAL_REASON]: _reason, ...rest } = input;
  return rest;
}

/** JSON Schema for one input field (the subset the tools use). */
export type PropertySchema = {
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: readonly string[];
  items?: { type?: PropertySchema['type'] };
};

export type ToolParameters = {
  type: 'object';
  properties: Record<string, PropertySchema>;
  required: string[];
  additionalProperties: false;
};

/** A JSON Schema for an object, as an MCP server describes its tool's input. */
export type JsonObjectSchema = { type: 'object'; [key: string]: unknown };

/** OpenAI-compatible function tool definition. */
export type ToolDefinition = {
  type: 'function';
  function: { name: string; description: string; parameters: ToolParameters | JsonObjectSchema };
};

export interface ToolSpec<I> {
  name: string;
  description: string;
  /** JSON Schema per input field; all are required unless named in `optional` */
  properties?: Record<string, PropertySchema>;
  /** fields the model may leave out (their type in `I` must allow undefined) */
  optional?: readonly (keyof I & string)[];
  /** ask the human before running (side effects) */
  needsApproval?: boolean;
  run: (input: I, ctx: ToolContext) => Promise<unknown>;
}

/** A tool as the agent loop sees it, whatever its input type. */
export interface AnyTool {
  readonly name: string;
  readonly needsApproval: boolean;
  readonly definition: ToolDefinition;
  /** An error message for the model, or null when the input is fine. */
  validate(input: unknown): string | null;
  /** Run with input that validate() accepted. */
  runValidated(input: unknown, ctx: ToolContext): Promise<unknown>;
}

export interface Tool<I> extends AnyTool {
  run(input: I, ctx: ToolContext): Promise<unknown>;
}

/**
 * Build a tool in the shape the agent loop expects.
 *
 * `description` is what the model reads to decide *when* to use the tool, so say
 * when to call it, not only what it does.
 *
 * `I` is the input type the schema in `properties` describes; validate() checks
 * model input against that schema before the tool runs.
 */
export function defineTool<I>({
  name,
  description,
  properties = {},
  optional = [],
  needsApproval = false,
  run,
}: ToolSpec<I>): Tool<I> {
  const isOptional = new Set<string>(optional);
  const parameters: ToolParameters = {
    type: 'object',
    properties: needsApproval
      ? { ...properties, [APPROVAL_REASON]: APPROVAL_REASON_PROPERTY }
      : properties,
    required: Object.keys(properties).filter((key) => !isOptional.has(key)),
    additionalProperties: false,
  };
  return {
    name,
    needsApproval,
    run,
    validate: (input) => validateInput(parameters, input),
    // validate() has checked the input against the schema `I` describes.
    runValidated: (input, ctx) => run(withoutReason(withoutNulls(input)) as I, ctx),
    definition: { type: 'function', function: { name, description, parameters } },
  };
}

const TYPE_CHECKS: Record<NonNullable<PropertySchema['type']>, (v: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  integer: Number.isInteger,
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  array: Array.isArray,
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
};

const isObject = (v: unknown): v is Record<string, unknown> => TYPE_CHECKS.object(v);

/**
 * Light check of model-supplied arguments against the tool's schema. Not every
 * OpenAI-compatible server enforces schemas, and smaller models get them wrong,
 * so check here and send a clear error back that the model can fix.
 * @returns an error message, or null when the input is fine
 */
function validateInput(schema: ToolParameters, input: unknown): string | null {
  if (!isObject(input)) return 'Arguments must be a JSON object.';
  for (const key of schema.required) {
    if (!(key in input)) return `Missing required argument "${key}".`;
  }
  for (const [key, value] of Object.entries(input)) {
    const prop = Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
    if (!prop) return `Unknown argument "${key}".`;
    if (value === null && !schema.required.includes(key)) continue; // some models send null for "left out"
    if (prop.type && !TYPE_CHECKS[prop.type](value)) {
      return `Argument "${key}" must be of type ${prop.type}.`;
    }
    if (prop.enum && !prop.enum.some((option) => option === value)) {
      return `Argument "${key}" must be one of: ${prop.enum.join(', ')}.`;
    }
    const itemType = prop.items?.type;
    if (
      prop.type === 'array' &&
      itemType &&
      Array.isArray(value) &&
      !value.every((item) => TYPE_CHECKS[itemType](item))
    ) {
      return `Every item in "${key}" must be of type ${itemType}.`;
    }
  }
  return null;
}

/** Optional arguments sent as null mean "left out". */
function withoutNulls(input: unknown): unknown {
  if (!isObject(input)) return input;
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null));
}
