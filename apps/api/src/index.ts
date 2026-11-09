import fs from 'node:fs';
import path from 'node:path';
import { BackgroundTasks, createLogger, McpHub } from '@app/agent';
import { Store } from '@app/db';
import { createApp, WEB_DIST_DIR } from './app.js';
import { agentConfig, env, HOST, readAuthSettings } from './config/env.js';
import { createAuthService } from './features/auth/auth.service.js';
import { RunRegistry } from './features/runs/run-registry.js';
import { AppSettings } from './features/settings/app-settings.js';
import { logger } from './logger.js';

async function start(): Promise<void> {
  const auth = createAuthService(readAuthSettings(env));
  const store = new Store();
  // The data folders were renamed with the app; first move the old ones (and their logs).
  for (const note of await store.moveLegacyFolders()) logger.info(note);
  // The level is set in the app, so the logger asks for it on every line once it's loaded.
  let settings: AppSettings | null = null;
  const agentLogger = createLogger({
    level: () => settings?.current.logLevel ?? agentConfig.logLevel,
    logDir: agentConfig.logDir,
  });
  settings = await AppSettings.load(store);
  // MCP servers used to be set per workspace folder; move any old ones to the app's list.
  for (const note of await store.importLegacyMcp()) logger.info(note);

  const mcp = new McpHub({ logger: agentLogger });
  const tasks = new BackgroundTasks();

  const app = createApp({
    store,
    agentConfig,
    settings,
    agentLogger,
    runs: new RunRegistry(),
    mcp,
    tasks,
    auth,
  });
  const hasModels = (await store.models.list()).length > 0;
  const server = app.listen(env.PORT, HOST, () => {
    const hasWebApp = fs.existsSync(path.join(WEB_DIST_DIR, 'index.html'));
    logger.info(
      {
        url: `http://localhost:${env.PORT}`,
        servesWebApp: hasWebApp,
        signIn: auth.config.isEnabled,
      },
      hasWebApp
        ? 'agent app running'
        : 'agent API running (start the web app with npm run dev:web)',
    );
    if (!hasModels) {
      logger.warn('No models yet: add one in the app under Settings → Models before chatting.');
    }
  });

  // The integrated terminal's WebSocket; anything else upgrading is refused.
  server.on('upgrade', (req, socket, head) => {
    if (!app.handleUpgrade(req, socket, head)) socket.destroy();
  });

  // Stop the MCP servers, background tasks and terminals this app started before exiting.
  const shutdown = () => {
    app.closeTerminals();
    server.close();
    void Promise.allSettled([mcp.close(), tasks.close()]).then(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start().catch((error: unknown) => {
  logger.fatal(
    { err: error },
    `Can't start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
