## What this is

A prompt-driven AI agent on any OpenAI-compatible API. Node/Express/TypeScript API, React/TypeScript web app, terminal CLI. No database: data is JSON files in `~/.nimbrio-ai/` and each workspace's `.nimbrio-ai/`. For each prompt the model decides whether to answer, call tools, or plan first.

## Approach

- Read existing files before writing. Thorough in reasoning, concise in output.
- Do not guess APIs, versions, flags or package names. Verify by reading code or docs.
- Never commit secrets. Never commit or push on the user's behalf unless asked.

## Monorepo layout

npm workspaces (`apps/*`, `packages/*`). One lockfile at the root; always install from the root (`npm i <pkg> -w @app/<name>`).

```
apps/api            @app/api       Express API: /v1 REST + SSE run stream; serves apps/web/dist when built
apps/cli            @app/cli       terminal chat (same chats and workspaces as the web app)
apps/web            @app/web       React + Vite + Tailwind chat UI
apps/desktop        @app/desktop   Electron app: runs the built API in a utility process, shows the web app in a window
packages/agent      @app/agent     the agent: loop, planner, prompts, guardrails, LLM client, tools, memory
packages/db         @app/db        storage (files, no database): ~/.nimbrio-ai/ (workspace list, models with API keys, provider sign-ins, agent settings, MCP servers, mcp.json approvals) + each workspace's .nimbrio-ai/ files (chats, memory, settings, which MCP servers are on, attached files, skills), Store, runInChat
packages/shared     @app/shared    contracts shared by api, web and agent (types, Zod schemas, envelopes)
packages/tsconfig   @app/tsconfig  base / node / react tsconfigs
packages/eslint-config  @app/eslint-config  flat ESLint config (base + react)
docs/standards.md   full coding standards
```

Dependency direction: `shared` <- `agent` <- `db` <- `api`, `cli`; `web` depends on `shared` only. Never import "up" this chain or reach across workspaces with a relative `../../` path.

- Anything two workspaces must agree on (HTTP payloads, `StreamEvent`, `Plan`, `RunResult`, limits) lives in `@app/shared`. Duplicating a contract is a defect.
- The `~/.nimbrio-ai/` and workspace `.nimbrio-ai/` data files are read and written only in `@app/db`. Model calls live only in `@app/agent/src/llm.ts` (and `src/cursor/` for Cursor's models, which `llm.ts` hands over).
- Internal packages are consumed from `dist`. Rebuild after changing them (`npm run build:packages`), or run `npm run dev -w @app/<pkg>` in watch mode.

## TypeScript & structure

- `strict` + `noUncheckedIndexedAccess`. No `any` (use `unknown` and narrow), no non-null `!`.
- Node workspaces are ESM with `NodeNext`: relative imports end in `.js`.
- Naming: `camelCase` values, `PascalCase` types/components/classes, `UPPER_SNAKE_CASE` constants, `kebab-case` files except React components. Booleans read as questions (`isRunning`).
- Prettier formats (single quotes, width 100). ESLint zero warnings. No `console.*` outside `apps/cli`.
- Group by feature (`features/<feature>/`). No new abstraction until two real callers exist.

## Commands (repo root)

- `npm install` (a `.env`, from `.env.example`, is optional); models and agent settings are set in the app (Settings → Models / Agent)
- `npm run dev`: builds the packages once, then runs the API (:4000, `PORT`) and web app (:5173, `/v1` proxied) together via `concurrently` (Ctrl+C stops both); `npm run dev:api` / `npm run dev:web` still run one
- `npm start`: build everything and serve API + web on http://localhost:4000
- `npm run cli` / `npm run ask -- "prompt"`: terminal chat
- `npm run desktop`: build and open the Electron app from the checkout; `npm run desktop:dist`: build the installer (`apps/desktop/release/`). Details: `apps/desktop/CLAUDE.md`
- `npm test`: offline tests
- `npm run eval`: behaviour evals against the real model (costs money)
- `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format`

## Where to find detailed rules

- API -> `apps/api/CLAUDE.md`; web -> `apps/web/CLAUDE.md`; desktop -> `apps/desktop/CLAUDE.md`; agent core -> `packages/agent/CLAUDE.md`
- Full standards -> @docs/standards.md
