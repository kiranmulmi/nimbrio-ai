import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import type { AppContext } from './context.js';
import { attachmentsRouter } from './features/attachments/attachments.routes.js';
import { authConfigRouter, authRouter, requireUser } from './features/auth/auth.routes.js';
import {
  UPLOAD_BODY_LIMIT,
  createAttachmentsService,
} from './features/attachments/attachments.service.js';
import { chatsRouter } from './features/chats/chats.routes.js';
import { createChatsService } from './features/chats/chats.service.js';
import { filesRouter } from './features/files/files.routes.js';
import { gitRouter } from './features/git/git.routes.js';
import { createGitService } from './features/git/git.service.js';
import { createFilesService } from './features/files/files.service.js';
import { foldersRouter } from './features/folders/folders.routes.js';
import { createFoldersService } from './features/folders/folders.service.js';
import { infoRouter } from './features/info/info.routes.js';
import { mcpRouter } from './features/mcp/mcp.routes.js';
import { promptsRouter } from './features/prompts/prompts.routes.js';
import { providersRouter } from './features/providers/providers.routes.js';
import { createProvidersService } from './features/providers/providers.service.js';
import { tasksRouter } from './features/tasks/tasks.routes.js';
import { createTasksService } from './features/tasks/tasks.service.js';
import { terminalRouter } from './features/terminal/terminal.routes.js';
import { createTerminalService } from './features/terminal/terminal.service.js';
import { createTerminalSocket } from './features/terminal/terminal.socket.js';
import { createMcpService } from './features/mcp/mcp.service.js';
import { memoriesRouter } from './features/memories/memories.routes.js';
import { skillsRouter } from './features/skills/skills.routes.js';
import { createSkillsService } from './features/skills/skills.service.js';
import { modelsRouter } from './features/models/models.routes.js';
import { createModelsService } from './features/models/models.service.js';
import { runsRouter } from './features/runs/runs.routes.js';
import { createRunsService } from './features/runs/runs.service.js';
import { settingsRouter } from './features/settings/settings.routes.js';
import { workspacesRouter } from './features/workspaces/workspaces.routes.js';
import { createWorkspacesService } from './features/workspaces/workspaces.service.js';
import { httpLogOptions } from './http-logging.js';
import { NotFoundError } from './lib/errors.js';
import { logger } from './logger.js';
import { errorHandler } from './middleware/error.js';
import { localHostOnly, requireJson } from './middleware/local-only.js';

/** The built web app (`npm run build -w @app/web`). Served when present, so one port runs everything. */
export const WEB_DIST_DIR = fileURLToPath(new URL('../../web/dist/', import.meta.url));

export function createApp(context: AppContext) {
  const workspaces = createWorkspacesService(context);
  const chats = createChatsService(context, workspaces);
  const files = createFilesService(workspaces);
  const git = createGitService(workspaces);
  const tasks = createTasksService(context, workspaces);
  const models = createModelsService(context);
  const attachments = createAttachmentsService(context, workspaces);
  const skills = createSkillsService(context, workspaces);
  const runs = createRunsService(context, workspaces, chats, models, attachments, skills);
  const terminals = createTerminalService(workspaces);

  const app = express();
  app.disable('x-powered-by');
  app.use(localHostOnly);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // blob: lets the composer preview a pasted or picked image before it is sent. With
          // sign-in on, the sidebar shows the user's Google profile photo.
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            ...(context.auth.config.isEnabled ? ['https://*.googleusercontent.com'] : []),
          ],
          // The web app signs in with Supabase straight from the browser.
          'connect-src': [
            "'self'",
            ...(context.auth.config.isEnabled ? [context.auth.config.supabaseUrl] : []),
          ],
        },
      },
    }),
  );
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()) }));
  app.use(pinoHttp({ logger, ...httpLogOptions }));
  app.use(requireJson);
  // Uploads carry a file as base64, so only they get a larger body; everything else stays at 1 MB.
  app.use('/v1/workspaces/:workspaceId/attachments', express.json({ limit: UPLOAD_BODY_LIMIT }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ data: { status: 'ok' } });
  });

  const v1 = express.Router();
  v1.use(authConfigRouter(context.auth));
  // Everything below needs a signed-in user when sign-in is on.
  v1.use(requireUser(context.auth));
  v1.use(authRouter());
  v1.use(infoRouter(context));
  v1.use(settingsRouter(context.settings));
  v1.use(modelsRouter(models));
  v1.use(providersRouter(createProvidersService(context)));
  v1.use(promptsRouter(context, models));
  v1.use(workspacesRouter(workspaces));
  v1.use(chatsRouter(chats));
  v1.use(memoriesRouter(context, workspaces));
  v1.use(skillsRouter(skills));
  v1.use(mcpRouter(createMcpService(context, workspaces)));
  v1.use(filesRouter(files));
  v1.use(gitRouter(git));
  v1.use(tasksRouter(tasks));
  v1.use(attachmentsRouter(attachments));
  v1.use(terminalRouter(terminals));
  v1.use(foldersRouter(createFoldersService(context)));
  v1.use(runsRouter(runs, context.runs));
  app.use('/v1', v1);

  if (fs.existsSync(path.join(WEB_DIST_DIR, 'index.html'))) {
    app.use(express.static(WEB_DIST_DIR, { index: false }));
    // Client-side routes: every other GET gets the app shell.
    app.get(/^\/(?!v1\/|health$).*/, (_req, res) => {
      res.sendFile(path.join(WEB_DIST_DIR, 'index.html'));
    });
  }

  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
  });

  app.use(errorHandler);

  // The terminal's WebSocket upgrades bypass Express; the server hands them to this.
  const terminalSocket = createTerminalSocket(terminals);
  return Object.assign(app, {
    handleUpgrade: terminalSocket.handleUpgrade,
    closeTerminals: terminals.closeAll,
  });
}
