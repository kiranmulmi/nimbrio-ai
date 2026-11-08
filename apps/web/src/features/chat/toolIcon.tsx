import type { ComponentType, SVGProps } from 'react';
import {
  BrainIcon,
  CalculatorIcon,
  ClockIcon,
  CopyIcon,
  EditIcon,
  FileIcon,
  FilePlusIcon,
  FlagIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GlobeIcon,
  ImageIcon,
  LinkIcon,
  MoveIcon,
  PaperclipIcon,
  PulseIcon,
  SearchIcon,
  ServerIcon,
  SkillIcon,
  StopIcon,
  TerminalIcon,
  TrashIcon,
  WrenchIcon,
} from '../../lib/icons';

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

/** The agent's built-in tools, each drawn with what it does. */
const TOOL_ICONS: Readonly<Record<string, Icon>> = {
  read_file: FileIcon,
  write_file: FilePlusIcon,
  edit_file: EditIcon,
  list_files: FolderOpenIcon,
  find_files: SearchIcon,
  search_files: SearchIcon,
  create_folder: FolderPlusIcon,
  move_path: MoveIcon,
  copy_path: CopyIcon,
  delete_path: TrashIcon,
  run_command: TerminalIcon,
  task_output: PulseIcon,
  stop_task: StopIcon,
  web_search: GlobeIcon,
  fetch_page: LinkIcon,
  read_attachment: PaperclipIcon,
  save_attachment: PaperclipIcon,
  view_image: ImageIcon,
  remember: BrainIcon,
  recall: BrainIcon,
  forget: BrainIcon,
  create_plan: FlagIcon,
  update_plan: FlagIcon,
  add_plan_steps: FlagIcon,
  get_current_time: ClockIcon,
  use_skill: SkillIcon,
  calculator: CalculatorIcon,
  load_mcp_tools: ServerIcon,
};

/** The icon for a tool call: its own, a server for MCP tools (`mcp__server__tool`), else a wrench. */
export function toolIcon(name: string): Icon {
  return TOOL_ICONS[name] ?? (name.startsWith('mcp__') ? ServerIcon : WrenchIcon);
}
