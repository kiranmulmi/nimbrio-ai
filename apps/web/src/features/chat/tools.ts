import { hostOf, parseArgs, shorten } from '../../lib/format';

/** The plan panel shows these; in the chat they would only repeat it. */
export const PLAN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'create_plan',
  'update_plan',
  'add_plan_steps',
]);

const text = (value: unknown) => (typeof value === 'string' ? value : '');

const ACTIVITY: Record<string, (args: Record<string, unknown>) => string> = {
  web_search: (a) => `Searching “${shorten(text(a.query), 60)}”`,
  fetch_page: (a) =>
    `Reading ${hostOf(a.url)}${typeof a.page === 'number' && a.page > 1 ? ` · part ${a.page}` : ''}`,
  list_files: (a) => `Looking through ${text(a.path) || 'the workspace'}`,
  read_file: (a) => `Reading ${text(a.path)}`,
  find_files: (a) => `Finding files named ${shorten(text(a.pattern), 40)}`,
  search_files: (a) => `Searching files for “${shorten(text(a.query), 50)}”`,
  write_file: (a) => `Writing ${text(a.path)}`,
  edit_file: (a) => `Editing ${text(a.path)}`,
  create_folder: (a) => `Creating folder ${text(a.path)}`,
  move_path: (a) => `Moving ${text(a.from)} to ${text(a.to)}`,
  copy_path: (a) => `Copying ${text(a.from)} to ${text(a.to)}`,
  delete_path: (a) => `Deleting ${text(a.path)}`,
  run_command: (a) => `Running ${shorten(text(a.command), 60)}`,
  calculator: () => 'Calculating',
  get_current_time: () => 'Checking the date and time',
  remember: () => 'Saving to memory',
  recall: () => 'Searching memory',
  forget: () => 'Deleting from memory',
};

/** A short line for the plan panel about what a tool call is doing. */
export function describeActivity(name: string, args: string): string {
  const describe = ACTIVITY[name];
  return describe ? describe(parseArgs(args)) : `Running ${name}`;
}

/** How many steps an `add_plan_steps` call adds. */
export function addedStepCount(args: string): number {
  const steps = parseArgs(args).steps;
  return Array.isArray(steps) ? steps.length : 0;
}
