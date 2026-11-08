// The operating system's own "choose a folder" window, opened on this machine (the API only
// listens locally, so it's the user's own screen). Paths come back as plain text; nothing the
// user typed is put into a command line: the start folder and prompt are passed as arguments
// or environment variables.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpError } from '../../lib/errors.js';

const PROMPT = 'Choose the folder for this workspace';

/** null: cancelled. undefined: this system has no dialog to open. */
type DialogResult = string | null | undefined;

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number | null; out: string; err: string } | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
    child.on('error', () => resolve(null)); // not installed
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

// macOS: AppleScript's choose folder, asked of `target` so the window comes to the front.
const macScript = (target: string): string[] => [
  'on run argv',
  `  tell ${target}`,
  '    activate',
  '    set chosen to choose folder with prompt (item 1 of argv) default location (POSIX file (item 2 of argv))',
  '  end tell',
  '  return POSIX path of chosen',
  'end run',
];
// System Events puts the window in front of the browser, but needs the Automation permission
// for whatever app started the API (Terminal, iTerm, ...); osascript itself needs none.
const MAC_TARGETS = ['application "System Events"', 'current application'];
// AppleScript's "User canceled." error number.
const MAC_CANCELLED = '(-128)';

async function openMacDialog(start: string): Promise<DialogResult> {
  let failure = '';
  for (const target of MAC_TARGETS) {
    const args = macScript(target).flatMap((line) => ['-e', line]);
    const result = await run('osascript', [...args, PROMPT, start]);
    if (!result) return undefined;
    if (result.code === 0) return result.out.trim();
    if (result.err.includes(MAC_CANCELLED)) return null;
    failure = result.err.trim();
  }
  throw new HttpError(
    500,
    'FOLDER_DIALOG_FAILED',
    `macOS wouldn't open the folder window${failure ? `: ${failure}` : '.'}`,
  );
}

// Windows: the standard folder browser, started at AGENT_START.
const WINDOWS_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$d.Description = $env:AGENT_PROMPT',
  '$d.SelectedPath = $env:AGENT_START',
  '$d.ShowNewFolderButton = $true',
  '$top = New-Object System.Windows.Forms.Form -Property @{TopMost = $true}',
  'if ($d.ShowDialog($top) -eq "OK") { Write-Output $d.SelectedPath }',
].join('; ');

async function openDialog(start: string): Promise<DialogResult> {
  if (process.platform === 'darwin') return openMacDialog(start);
  if (process.platform === 'win32') {
    const result = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', WINDOWS_SCRIPT], {
      ...process.env,
      AGENT_PROMPT: PROMPT,
      AGENT_START: start,
    });
    if (!result) return undefined;
    return result.out.trim() || null;
  }
  // Linux and others: zenity (GNOME), then kdialog (KDE).
  const zenity = await run('zenity', [
    '--file-selection',
    '--directory',
    `--title=${PROMPT}`,
    `--filename=${start}${path.sep}`,
  ]);
  if (zenity) return zenity.code === 0 ? zenity.out.trim() : null;
  const kdialog = await run('kdialog', ['--title', PROMPT, '--getexistingdirectory', start]);
  if (kdialog) return kdialog.code === 0 ? kdialog.out.trim() : null;
  return undefined;
}

let isOpen = false;

/** Opens the dialog and waits for the user. One at a time. */
export async function pickFolderWithSystemDialog(
  startAt?: string,
): Promise<{ path: string | null; isSupported: boolean; isBusy: boolean }> {
  if (isOpen) return { path: null, isSupported: true, isBusy: true };
  const wanted = startAt?.trim()
    ? path.resolve(startAt.trim().replace(/^~(?=$|\/)/, os.homedir()))
    : '';
  const start = wanted && fs.existsSync(wanted) ? wanted : os.homedir();
  isOpen = true;
  try {
    const chosen = await openDialog(start);
    if (chosen === undefined) return { path: null, isSupported: false, isBusy: false };
    if (chosen === null || !chosen) return { path: null, isSupported: true, isBusy: false };
    // "/Users/me/project/" from AppleScript: no trailing separator (except the root itself).
    const clean = chosen.length > 1 ? chosen.replace(/[\\/]+$/, '') : chosen;
    return { path: clean, isSupported: true, isBusy: false };
  } finally {
    isOpen = false;
  }
}
