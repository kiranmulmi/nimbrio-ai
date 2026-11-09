import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  session,
  shell,
  utilityProcess,
  type UtilityProcess,
} from 'electron';
import { loginShellPath, mergePaths } from './shell-path.js';

/**
 * The API on this port when it's free. A fixed port keeps the window's origin the same from one
 * launch to the next, and with it what the web app keeps in localStorage (theme, panel sizes).
 */
const PREFERRED_PORT = 47821;
const HOST = '127.0.0.1';
const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 5000;
/** Packaged and from the repo alike, the API sits at apps/api/dist next to apps/desktop/dist. */
const SERVER_ENTRY = path.join(import.meta.dirname, '../../api/dist/index.js');
const PRELOAD = path.join(import.meta.dirname, 'preload.cjs');
const IS_MAC = process.platform === 'darwin';

let server: UtilityProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let origin = '';
let isQuitting = false;

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, HOST, () => probe.close(() => resolve(true)));
  });
}

function anyFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('No free port.'))));
    });
  });
}

function serverLogPath(): string {
  const dir = app.getPath('logs');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'server.log');
}

/** Resolves once GET /health answers; rejects if the server exits or takes too long. */
async function waitUntilReady(port: number, child: UtilityProcess): Promise<void> {
  let hasExited = false;
  child.once('exit', () => {
    hasExited = true;
  });
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (hasExited) throw new Error('The server stopped while starting.');
    try {
      const response = await fetch(`http://${HOST}:${port}/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`The server didn't start within ${START_TIMEOUT_MS / 1000} seconds.`);
}

/** Starts the app's API (apps/api) in a background process and waits for it. */
async function startServer(): Promise<number> {
  const port = (await canListen(PREFERRED_PORT)) ? PREFERRED_PORT : await anyFreePort();
  const shellPath = await loginShellPath();
  const log = fs.createWriteStream(serverLogPath(), { flags: 'w' });
  const child = utilityProcess.fork(SERVER_ENTRY, [], {
    serviceName: 'Nimbrio AI server',
    stdio: 'pipe',
    env: {
      ...process.env,
      PATH: shellPath ? mergePaths(shellPath, process.env.PATH ?? '') : process.env.PATH,
      PORT: String(port),
      NODE_ENV: 'production',
      // A desktop install is one person's app on their own machine: no sign-in, even when run
      // from a checkout whose .env sets Supabase up (values set here win over the .env).
      SIGN_IN: 'off',
    },
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  child.once('exit', (code) => {
    server = null;
    log.end();
    if (isQuitting) return;
    dialog.showErrorBox(
      'Nimbrio AI stopped',
      `The app's server stopped unexpectedly (exit code ${code}).\n\nDetails are in ${serverLogPath()}`,
    );
    app.quit();
  });
  server = child;
  await waitUntilReady(port, child);
  return port;
}

function isWebUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://');
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 380,
    minHeight: 560,
    title: 'Nimbrio AI',
    show: false,
    // The page's own --bg, so opening doesn't flash white in dark mode.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#08131f' : '#f2f7f6',
    // macOS: no title bar; the window buttons sit in the app's own 48px top bar, which leaves
    // room for them and moves the window (the web app's index.css, data-desktop).
    ...(IS_MAC ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 17 } } : {}),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.once('ready-to-show', () => window.show());
  // Full screen hides the window buttons, so the bars can take their room back.
  const markFullScreen = (isFullScreen: boolean) => {
    const script = isFullScreen
      ? "document.documentElement.dataset.fullscreen = '1'; undefined"
      : 'delete document.documentElement.dataset.fullscreen; undefined';
    void window.webContents.executeJavaScript(script).catch(() => undefined);
  };
  window.on('enter-full-screen', () => markFullScreen(true));
  window.on('leave-full-screen', () => markFullScreen(false));

  // Links the app opens in a new tab (answers, docs, sign-in pages) go to the user's browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // The window only ever shows this app; anything else opens in the browser instead.
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === origin) return;
    event.preventDefault();
    if (isWebUrl(url)) void shell.openExternal(url);
  });

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  mainWindow = window;
  void window.loadURL(`${origin}/`);
}

/** Only this app's own page may ask for permissions (the microphone, for voice mode). */
function limitPermissionsToApp(): void {
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback, details) => {
      callback(new URL(details.requestingUrl).origin === origin);
    },
  );
  session.defaultSession.setPermissionCheckHandler(
    (_contents, _permission, requestingOrigin) => requestingOrigin === origin,
  );
}

/** Stops the server (it stops its MCP servers, tasks and terminals), then lets the app quit. */
function stopServer(): Promise<void> {
  const child = server;
  if (!child) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, STOP_TIMEOUT_MS);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

async function launch(): Promise<void> {
  const port = await startServer();
  origin = `http://${HOST}:${port}`;
  limitPermissionsToApp();
  createWindow();
}

if (!app.requestSingleInstanceLock()) {
  // Another copy is already running: it focuses its window (below) and this one leaves.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (origin && BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('before-quit', (event) => {
    if (isQuitting || !server) return;
    isQuitting = true;
    event.preventDefault();
    void stopServer().then(() => app.quit());
  });

  app
    .whenReady()
    .then(launch)
    .catch((error: unknown) => {
      isQuitting = true;
      server?.kill();
      dialog.showErrorBox(
        "Nimbrio AI couldn't start",
        `${error instanceof Error ? error.message : String(error)}\n\nDetails are in ${serverLogPath()}`,
      );
      app.quit();
    });
}
