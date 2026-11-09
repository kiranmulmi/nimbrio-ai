# Coding Standards

Standards for this repo: an AI agent with a Node/Express/TypeScript API, a React/TypeScript web app, a terminal CLI, and its data in JSON files (no database).

## General

- Clear, self-documenting code. Comments explain _why_, not _what_.
- No dead or commented-out code. No abstraction before two real callers.
- This is a local tool that can write files: safety rules (below) are not optional.

## TypeScript

- `strict` and `noUncheckedIndexedAccess` in every workspace (via `@app/tsconfig`).
- No `any`: use `unknown` and narrow. No non-null assertions (`!`).
- `type` for unions and primitives, `interface` for object shapes. `const` by default. `async`/`await`.
- Node workspaces are ESM (`"type": "module"`, `NodeNext`); relative imports use the `.js` extension.

## Naming

- `camelCase` variables and functions; `PascalCase` types, classes and React components; `UPPER_SNAKE_CASE` true constants; `kebab-case` filenames except React components.
- Booleans read as questions: `isRunning`, `hasPlan`, `canEdit`.

## Formatting & linting

- Prettier is the source of truth (2 spaces, single quotes, trailing commas, semicolons, width 100).
- ESLint passes with zero warnings. `no-console` is on everywhere except `apps/cli`.

## Monorepo

- npm workspaces: `apps/*` are runnable, `packages/*` are libraries. One `package-lock.json`, at the root. Install from the root only.
- Workspaces are named `@app/<name>` and depend on each other as `"@app/<name>": "*"`, imported by package name.
- Dependency direction: `shared` <- `agent` <- `db` <- `api`, `cli`; `web` -> `shared` only.
- Contracts both sides must agree on live in `@app/shared`. Internal packages are built to `dist` and consumed from there; root `build:packages` builds them in order.
- Each workspace extends `@app/tsconfig` and uses `@app/eslint-config`.

## Agent core (`@app/agent`)

- `llm.ts` is the only file that calls the model (it hands Cursor's models to `cursor/caller.ts`). Everything else takes a `CallModel`, so tests can pass a fake.
- Config is read from env only by `loadAgentConfig`, called by the apps. Library code never reads `process.env` at import time.
- One file per tool in `src/tools/`, built with `defineTool`. The description says _when_ to use the tool. Arguments are validated in code. Tools that change anything outside the agent set `needsApproval: true`.
- Every new tool or behaviour gets an offline test (fake model) and, where model behaviour matters, an eval case.

## Backend (`@app/api`)

- Routes are thin: validate with Zod (schemas from `@app/shared`), delegate to a service. Storage stays in `@app/db`.
- Throw typed errors (`NotFoundError`, `ValidationError`, `ConflictError`, ...); map to HTTP only in `middleware/error.ts`.
- Never catch just to log and rethrow. Structured logging with pino; no `console.*`.
- Every async handler is wrapped (`asyncHandler`).

## API conventions

- REST, plural nouns, versioned under `/v1`.
- Success `{ data }`; failure `{ error: { code, message } }`. 201 on create, 204 on delete, 4xx for client errors.
- Long-running work streams server-sent events: one `data: <json StreamEvent>` frame per event. Validate and claim resources _before_ the stream starts, so request errors stay JSON.

## Frontend (`@app/web`)

- Rules of hooks; correct effect dependencies (never disable the lint rule). State as local as possible.
- Tailwind with the CSS variables in `index.css`; every surface supports light and dark. Theme (light/dark/system) is applied as `data-theme` on `<html>`.
- Never hardcode an API URL: `VITE_API_URL` through `src/lib/api.ts`. Response types come from `@app/shared`.
- Server state goes through the API, never `localStorage` (UI preferences only).
- Forms (create/edit workspace) live on their own page. Deletes need a modal confirmation; never `window.confirm`. Show a toast after every save, rename and delete.
- The URL reflects what is open (workspace, chat), so reload and back/forward work.
- Mobile-first: the chat screen works at phone width.

## Storage

- There is no database. The app's global data (the workspace list, models, agent settings, MCP servers, mcp.json approvals, provider sign-ins) is JSON files in the user's `~/.nimbrio-ai/` (`app-home.ts` in `@app/db`); each workspace's data is in its own `.nimbrio-ai/`. Only `@app/db` reads or writes them.
- Writes are atomic (`writeFileAtomic`) and each read-change-write of a file runs in its own queue (`serialized`). Files that can hold secrets are written `0600` (`writePrivateJson`).
- Read files leniently where a default is safe, but a damaged file holding user data is an error naming the file, never silently replaced. `uuid` ids for exposed entities.

## Security

- Never commit secrets or `.env`. Secrets come from env via one config module per app, except model API keys: those are entered in the app, stored by `@app/db` in `~/.nimbrio-ai/models.json` (written `0600`), and never returned by the API (only `hasApiKey`).
- The API listens on 127.0.0.1 only, rejects foreign `Host` headers and non-JSON writes. Keep all three.
- Optional sign-in with Supabase Auth (`SUPABASE_URL` + `SUPABASE_ANON_KEY` in `.env`): every `/v1` route but `/v1/auth/config` then needs a verified access token of an `authenticated` user (`requireUser`), narrowed by `AUTH_ALLOWED_EMAILS`. Only the public anon key is used, never the service_role key. These values are kept from commands (`commandEnv`) like the app's other settings.
- File tools are sandboxed to the workspace's chosen folder (`resolveInWorkspace`, judged by the real path after symlinks); they never change the folder itself or `.git/` (`assertCanChange`), never reach the app's own `.nimbrio-ai/` data (`isInAppData`), and a workspace can't be the disk root or the home folder (`prepareWorkspaceFolder`). `run_command` always needs approval, runs in the workspace without this app's env secrets (`commandEnv`), and refuses catastrophic commands even in auto mode (`refuseCommand`); with `background: true` it keeps running as a task the user sees and can stop in the Tasks tab (where the user can also start one: no approval, as it's their own, but the same `refuseCommand`, workspace folder and env), a chat only reaches its own workspace's tasks, and the app stops them all when it exits. Page fetches refuse private addresses (`assertPublicUrl`).
- Provider sign-ins (Cursor) are saved by `@app/db` in `~/.nimbrio-ai/providers.json` (written `0600`) and never returned by the API (only who is signed in). The PKCE verifier of a sign-in in progress stays in the API's memory; the browser gets only the provider's login URL. A Cursor model's run gets the token from `store.providers` (renewed when it ran out), sends it only to `api2.cursor.sh` and the `*.api5.cursor.sh` chat host Cursor names, and declines Cursor's own tools, so everything the model does goes through this app's tools and approvals.
- Attached files are kept in the workspace's `.nimbrio-ai/uploads/` (ids are UUIDs, names stripped of folders), read by the agent only through the attachment tools; copying one into the workspace (`save_attachment`) needs approval. The API serves them back inline only for images and PDFs, as downloads otherwise.
- Skills are the user's own prompt text in the workspace's `.nimbrio-ai/skills/<name>.md`: written only from the app (the file tools can't reach `.nimbrio-ai/`), read through `SkillStore`, named in kebab-case so a name is never a path, read without following links. Loading one (`use_skill`) changes nothing, so it needs no approval, and a skill can't turn approvals off.
- The integrated terminal (`/v1/terminal/socket`) is a shell for the user, not the agent: it runs without approvals, so the socket accepts only this app's Origin and Host and a one-time ticket from a JSON request. Keep all three.
- MCP servers are set up once for the app (`~/.nimbrio-ai/mcp-servers.json`, written `0600`, only written from the app) and turned on per workspace in `.nimbrio-ai/mcp.json` (`{ "enabled": [names] }`, off until turned on). Their tools ask before each run unless listed in the server's `autoApprove`. A workspace's choices take effect only once approved in the app (fingerprints in `~/.nimbrio-ai/mcp-trust.json`, never in the workspace), so a planted or hand-edited `mcp.json` turns nothing on until reviewed. Local servers get only the SDK's safe env (PATH, HOME, ...) plus their configured `env`, never this app's secrets.
- Run `npm audit` regularly; patch high/critical promptly.

## Git

- Don't commit or push on the user's behalf unless asked.
