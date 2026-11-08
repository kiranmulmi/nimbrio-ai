# Nimbrio AI

A prompt-driven agent written in TypeScript that works with any OpenAI-compatible API: OpenAI, Ollama, LM Studio, OpenRouter, Groq, vLLM and others. There is no hard-coded routing. For each prompt, the model decides what to do next: answer directly, call a tool, make a plan for a multi-step task, or ask a clarifying question. It keeps deciding after every tool result until the job is done or a guardrail stops it.

## Quick start

```bash
npm install                 # installs every workspace, from the repo root
cp .env.example .env        # optional: port, log folder, eval model
npm start                   # builds everything, then serves the app at http://localhost:4000
                            #   add a model under Settings -> Models, then chat
npm run cli                 # chat in the terminal instead (add -- --workspace "Name" to pick one,
                            #   or -- --new "My app" --path ~/code/my-app to create one)
npm run ask -- "What is 18% of 52,300?"   # one prompt, then exit
npm test                    # offline tests, no API key or server needed
npm run eval                # behaviour evals against the real model (paid APIs bill for it)
```

While developing, run the API and the web app together with `npm run dev`, or each in its own terminal:

```bash
npm run dev                 # both below in one terminal (Ctrl+C stops both)
npm run dev:api             # API on http://localhost:4000, restarts on change
npm run dev:web             # web app on http://localhost:5173, proxies /v1 to the API
```

Needs Node 22.9 or later. There is no database to install: everything is saved in files.

## Workspaces and storage

Everything is per **workspace**: its chats, its memories, its folder and its own instructions for the agent (for example a "My app" workspace on `~/code/my-app` and a "Research" workspace on `~/notes/research`). Switch or create workspaces from the menu at the top of the sidebar; the gear opens the workspace's settings.

Each workspace lives in a **folder you choose** on your machine: type the path or click **Browse…** when you create it (a missing folder is created). The agent's file tools work only inside that folder: they list, read, find, search, write, edit, create folders, move, copy and delete. Every change asks for your approval first (set **Settings → Agent → Tool approvals** to "Run without asking" to skip the prompts). Paths that lead outside the folder, the folder itself, and anything in `.git/` are refused, the app's own `.nimbrio-ai/` folder can't be read or changed by them, and the disk root or your home folder can't be a workspace.

The agent can also **run commands** (`run_command`): bash in the workspace folder, for installs, tests, builds, linters, scripts and git. Every command asks for approval, gets no input, stops at a timeout (120 s by default, 600 s at most) and has anything it left running in the background stopped when it ends. Commands never see this app's own settings (`.env` values, model API keys, ...). A few commands are refused even when approvals are off: `sudo`/`su`, recursive deletes of `/`, `~` or `..`, formatting disks, shutting down, and piping a download into a shell. This is a backstop, not a sandbox: a command runs with your user's permissions, so read what you approve.

**Attach files** in the chat with the paperclip, by dropping them on the message box or by pasting (a screenshot, say): images, PDFs, Word documents (`.docx`) and text files such as code, CSV, JSON or Markdown, up to 10 per message and 15 MB each. They upload right away and are kept privately in the workspace's `.nimbrio-ai/uploads/`, not in your project. The agent reads them with its own tools: `read_attachment` (the text of a PDF page by page, a Word document, or a text file), `view_image` (shows an image to the model; this needs a model that can see images) and `save_attachment` (copies one into the workspace folder, with your approval, e.g. to put an uploaded logo into a site).

There is no database. The app's own data is global to your machine, so it's kept in files in your home folder, `~/.nimbrio-ai/` (written readable only by you, since some hold API keys and tokens). Run logs (JSONL, for debugging) go to `~/.nimbrio-ai/logs/`; set `AGENT_LOG_DIR` to move them. The app used to be called agentic-ai: on start it moves any old `~/.agentic-ai/` and workspace `.agentic-ai/` folders to the new name.

| File                  | Holds                                                                   |
| --------------------- | ----------------------------------------------------------------------- |
| `workspaces.json`     | the list of workspaces: id, name, folder path                           |
| `models.json`         | the models (Settings → Models), with their API keys                     |
| `agent-settings.json` | how the agent behaves (Settings → Agent)                                |
| `mcp-servers.json`    | MCP servers in the `{ "mcpServers": … }` shape, turned on per workspace |
| `mcp-trust.json`      | which workspace `mcp.json` files you approved                           |

Everything else is saved in the workspace's own folder, under `.nimbrio-ai/` (it ignores itself in git, and file tools can't reach it). Changing a workspace's folder moves it along; deleting a workspace deletes it, and leaves the rest of the folder alone.

| File                        | Holds                                                   |
| --------------------------- | ------------------------------------------------------- |
| `settings.json`             | instructions, planning choice, tool groups turned off   |
| `memory.json`               | the workspace's saved facts                             |
| `chats/<id>/chat.json`      | title, current plan, earlier plans                      |
| `chats/<id>/messages.jsonl` | the conversation, exactly as sent to the model          |
| `chats/<id>/runs.jsonl`     | one line per request: status, steps, tools used, tokens |
| `mcp.json`                  | which of the app's MCP servers are on here              |
| `uploads/<id>/`             | an attached file (`file`) and its details (`meta.json`) |
| `skills/<name>.md`          | a skill: name and description up top, then the steps    |

Adding a folder that already has a `.nimbrio-ai/` folder (say, after deleting the workspace from the list, or on a new machine) brings its chats, memory and settings back.

## How a prompt flows

```
you> prompt
  -> guardrails.checkInput
  -> 1. PLAN   planning step (one model call, no tools) decides:
                 "direct" -> go straight to the loop
                 "plan"   -> goal + steps + "done when", shown in the Plan panel
  -> 2. ACT    loop: model + tools (search, read pages, files, memory, ...)
                 the model ticks off plan steps, adds steps it discovers, re-plans if needed
  -> 3. CHECK  final answer with plan steps still open? sent back once to finish or explain
  -> 4. LIMIT  out of steps/tokens? one tool-free call writes up what was found
  -> answer

  messages you send while it works wait, and are added before its next model call
  (after a step's tool results) or before it settles on an answer
```

The agent decides by itself, per request, whether to plan: greetings, single questions and single lookups are answered directly; research over several items, gather-then-write tasks and anything easy to get half-done get a plan. Turn off **Settings → Agent → Plan multi-step work first** to skip the planning step.

This is a hybrid of the two common agent patterns: **plan-and-execute** for big tasks, **ReAct** (reason, act, observe, repeat) for small ones and inside each plan step.

## Web UI

`npm start` and open http://localhost:4000 (set `PORT` to change it; the dev proxy follows it). In development the web app runs on http://localhost:5173 instead (`npm run dev`).

- **Chat** with answers that stream in word by word, and live tool steps. Click a step to see its input and result. Text the agent writes on its way to a tool call shows as a muted note.
- **Approvals** appear as Allow/Deny cards when the agent wants to write a file.
- **Steer while it works:** the message box stays open during a run. What you send waits above the box ("Waiting for the next step") until the agent reads it: after the tool results of its current step, or just before it would finish. It then shows in the chat as your message ("Sent while the agent worked") and the agent carries on with it in mind: narrow the task, correct it, add to it, or say why you denied an approval. Text only; files and picked skills wait for your next message. If the run ends before reading a message, it goes back into the message box. Stop still ends the run at once.
- **Attachments:** the paperclip, drag and drop or paste adds files to the next message; they show as chips while they upload, and images as thumbnails in the sent message (click to open).
- **Sidebar:** the workspace switcher and the workspace's saved chats. Click to reopen a chat, double-click (or ✎) to rename, ✕ twice to delete. The open chat is in the page address, so reload and back/forward work.
- **Plans** appear in the conversation where the agent made them, folded (click to open). The plan being worked on is also docked above the message box (status, count, the current step; click for all steps), so its progress stays in view.
- **Side panel:** the workspace's files (click one to preview, search and copy it; drag one onto the message box to insert its path), memories, MCP servers and an integrated terminal in the workspace folder.
- **New chat** starts another chat in the same workspace. The workspace's memories are kept.
- **Per-workspace planning and tools:** in a workspace's settings, Planning follows Settings → Agent or is on or off just there, and Tools turns off groups it doesn't need (files, commands, web, memory, plans). Off groups' tools and prompt rules aren't sent, so a chat-only workspace (a language tutor, say) uses far fewer tokens per message. Attachment and skill tools are only sent when a chat has files or the workspace has skills.
- **MCP tools on demand:** the MCP servers you turn on in a workspace are listed to the agent by tool name only; it loads the full definitions of the tools a task needs (`load_mcp_tools`) and only those are sent from then on. A plain message doesn't pay for a server's tools (Atlassian's are ~25K tokens).
- **Skills:** instructions you write for a kind of task (a ticket workflow, a review checklist) in the Skills tab under the side panel. The agent sees each skill's name and description and loads the one a task needs with `use_skill`; to choose yourself, pick skills for a message with the Skills button in the message box, and they're sent with it in full. A skill guides how the agent works; it never turns approvals off.
- **Memory:** saved memories are added to the first message of every chat (and to the planning step), so the agent follows your preferences from its first reply. If you change them in the Memory panel mid-chat, the new list is sent with your next message. The agent updates an existing memory rather than saving a near-copy.

The API only listens on 127.0.0.1, so other devices on your network can't reach it, and it rejects requests addressed to any other host name and non-JSON writes. Keep it that way: the agent can write files.

## Project layout

An npm-workspaces monorepo. Apps are things you run; packages are libraries they share.

```
nimbrio-ai/
├── apps/
│   ├── api/                Express API (@app/api): /v1 REST + a server-sent-events run stream
│   │   └── src/            app.ts, index.ts, config/, middleware/, lib/, features/<feature>/
│   ├── web/                React + Vite + Tailwind chat UI (@app/web)
│   └── cli/                terminal chat (@app/cli): --once mode, --new/--path, /plan /memory /workspace /folder /reset
├── packages/
│   ├── agent/              the agent (@app/agent), no HTTP and no database
│   │   ├── src/agent.ts    the agent loop: call model -> run tools -> repeat
│   │   ├── src/prompt.ts   system prompt: how the model chooses its next action
│   │   ├── src/planner.ts  planning step (direct vs plan) + plan state
│   │   ├── src/guardrails.ts  input checks, step/token budget, file sandbox, approval
│   │   ├── src/llm.ts      the only file that calls the model (OpenAI Chat Completions)
│   │   ├── src/config.ts   settings, read from .env by the apps
│   │   ├── src/logger.ts   console output + JSONL logs
│   │   ├── src/memory/     short-term.ts (conversation), long-term.ts (saved facts)
│   │   ├── src/tools/      one file per tool + index.ts registry (files/: the file tools)
│   │   ├── test/           free tests with a fake model
│   │   └── evals/          behaviour checks against the real model
│   ├── db/                 storage (@app/db), files only: ~/.nimbrio-ai workspace list and settings, .nimbrio-ai folder data, Store, runInChat
│   ├── shared/             contracts shared by API, web and agent (@app/shared): types, Zod schemas
│   ├── tsconfig/           shared TypeScript configs
│   └── eslint-config/      shared ESLint config
└── docs/standards.md       coding standards
```

Dependencies point one way: `shared` <- `agent` <- `db` <- `api` and `cli`. `web` only uses `shared` and talks to the API over HTTP.

## Adding a tool

1. Create `packages/agent/src/tools/my-tool.ts` with `defineTool({ name, description, properties, run })`. Write the description to say _when_ the model should call it. That text is how the model decides.
2. Register it in `packages/agent/src/tools/index.ts`.
3. Set `needsApproval: true` if it changes anything outside the agent (writes files, sends messages, spends money). Arguments the model may leave out go in `optional`.
4. Add an offline test in `packages/agent/test/` and an eval case in `packages/agent/evals/cases.json` that checks the model picks it.

## Choosing models

Models are set up in the app, under **Settings → Models** (the "Models" link in the top bar's connection menu, or "Manage models" in the chat's model picker). They are app-wide: every workspace and the terminal chat use the same list. Add as many as you like; each needs:

| Field      | What to enter                                                                  |
| ---------- | ------------------------------------------------------------------------------ |
| Server     | the OpenAI-compatible base URL (presets for the servers below); empty = OpenAI |
| Model name | exactly as the server lists it, e.g. `gpt-4.1` or `llama3.1:8b`                |
| API key    | for hosted servers; not needed for Ollama or LM Studio                         |
| Reasoning  | on for reasoning models, so the chat offers a Low / Medium / High effort       |

| Server            | Base URL                         | API key     |
| ----------------- | -------------------------------- | ----------- |
| OpenAI            | leave empty                      | your key    |
| Ollama (local)    | `http://localhost:11434/v1`      | leave empty |
| LM Studio (local) | `http://localhost:1234/v1`       | leave empty |
| OpenRouter        | `https://openrouter.ai/api/v1`   | your key    |
| Groq              | `https://api.groq.com/openai/v1` | your key    |

In the chat, the message box has a model picker and, for reasoning models, an effort picker; the choice is remembered in the browser. One model is the **default**: it is used when none is picked and by the CLI (`npm run cli -- --model NAME` picks another; `/models`, `/model NAME` and `/effort low|medium|high|off` switch while chatting).

The model **must support tool (function) calling**, or the agent can only chat and can't use tools or plans. API keys are stored in `~/.nimbrio-ai/models.json` (readable only by you) and are never sent back to the browser; the UI only shows whether a key is saved.

For web search, set **Settings → Agent → SearXNG URL** (default `http://localhost:8080`) to a SearXNG instance with the JSON format turned on (`search.formats: [html, json]` in its `settings.yml`).

## Agent settings

Everything about how the agent behaves is set in the app under **Settings → Agent**, saved in `~/.nimbrio-ai/agent-settings.json` and applied from the next message (no restart): tool approvals (ask / run without asking / refuse), planning on or off, max model calls, the token budget and longest message per prompt, the SearXNG URL and the console log level. The CLI reads the same settings. `.env` is optional and keeps only server options: `PORT`, `CORS_ORIGIN`, `LOG_LEVEL` (HTTP logs) and `AGENT_LOG_DIR`, plus the `EVAL_*` values for evals.

Evals (`npm run eval`) don't read the app's saved models, so they take their model from `EVAL_MODEL`, `EVAL_BASE_URL` and `EVAL_API_KEY` in `.env`.

## Design notes

- **Chat Completions API.** This is the format almost every OpenAI-compatible server supports. Tools are sent as `function` tools, and results go back as `tool` messages matched by `tool_call_id`.
- **Arguments are checked in code.** Not every server enforces tool schemas, and smaller models make mistakes, so `packages/agent/src/tools/define.ts` validates arguments. Errors go back to the model so it can fix the call.
- **Optional settings are sent only when set.** A model's max tokens and the reasoning effort are left out of requests unless set, because some servers or models reject them. The effort is only sent for models marked as reasoning models.
- **Conversation history is append-only,** so servers that cache repeated prompt prefixes can reuse them. Start a new chat to start over.
- **Attached images are stored by reference.** A chat's saved messages hold the attachment id; the image is read and sent as an `image_url` part only when the model is called, so `messages.jsonl` stays small.
- **Workspace instructions go in the system prompt.** They stay the same for every request in a workspace, so caching still works.
