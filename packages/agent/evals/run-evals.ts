// Runs each case in evals/cases.json against the real model and checks the
// agent's decisions (which tools it chose) and its answers.
//
//   npm run eval -w @app/agent                 all cases
//   npm run eval -w @app/agent -- --only NAME  one case
//
// Each case gets a fresh temporary workspace folder (a tiny project) and memory
// store, so evals never touch your real files. This calls the real model server
// (paid APIs bill for it).
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { RunResult, Skill, Usage } from '@app/shared';
import { createAgent } from '../src/agent.js';
import { BackgroundTasks } from '../src/background-tasks.js';
import { loadAgentConfig } from '../src/config.js';
import type { ModelSettings } from '../src/llm.js';
import { createLogger } from '../src/logger.js';
import { LongTermMemory } from '../src/memory/long-term.js';
import type { SkillStore } from '../src/skills.js';
import { defineTool } from '../src/tools/define.js';
import { errorMessage } from '../src/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// The app's models are saved by @app/db (Settings -> Models), which this package can't
// reach, so evals name their model with EVAL_* variables in the repo root's .env.
const envFile = path.resolve(here, '..', '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const config = loadAgentConfig(process.env);

const evalEnv = z
  .object({
    EVAL_MODEL: z.string().min(1, 'Set EVAL_MODEL in .env to the model the evals run on.'),
    EVAL_BASE_URL: z.string().min(1).optional().catch(undefined),
    EVAL_API_KEY: z.string().catch(''),
    EVAL_REASONING_EFFORT: z.string().min(1).nullable().catch(null),
  })
  .safeParse(process.env);
if (!evalEnv.success) {
  process.stderr.write(`${evalEnv.error.issues[0]?.message ?? 'Bad EVAL_* settings.'}\n`);
  process.exit(1);
}
const model: ModelSettings = {
  label: 'the eval model',
  model: evalEnv.data.EVAL_MODEL,
  baseURL: evalEnv.data.EVAL_BASE_URL,
  apiKey: evalEnv.data.EVAL_API_KEY,
  maxTokens: null,
  contextWindow: null,
  reasoningEffort: evalEnv.data.EVAL_REASONING_EFFORT,
};

const out = (line = '') => process.stdout.write(`${line}\n`);

const caseSchema = z.object({
  name: z.string(),
  why: z.string().optional(),
  prompt: z.string(),
  priorSession: z.array(z.string()).optional(),
  /** adds a fake "tracker" MCP server (issue lookup and search), loaded with load_mcp_tools */
  fakeMcp: z.boolean().optional(),
  /** skills the workspace has (the agent sees them and may load one with use_skill) */
  skills: z
    .array(z.object({ name: z.string(), description: z.string(), body: z.string() }))
    .optional(),
  expectTools: z.array(z.string()).optional(),
  forbidTools: z.array(z.string()).optional(),
  outputIncludes: z.array(z.string()).optional(),
  outputExcludes: z.array(z.string()).optional(),
  checkFile: z.object({ path: z.string(), includes: z.array(z.string()).optional() }).optional(),
  /** a background task (run_command background: true) should still be running at the end */
  expectRunningTask: z.boolean().optional(),
});
type EvalCase = z.infer<typeof caseSchema>;

const cases = z
  .array(caseSchema)
  .parse(JSON.parse(await fs.readFile(path.join(here, 'cases.json'), 'utf8')));

const onlyIndex = process.argv.indexOf('--only');
const selected =
  onlyIndex === -1 ? cases : cases.filter((c) => c.name === process.argv[onlyIndex + 1]);
if (selected.length === 0) {
  process.stderr.write('No matching cases.\n');
  process.exit(1);
}

async function runCase(
  testCase: EvalCase,
): Promise<{ failures: string[]; result: RunResult | null; usage: Usage }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-eval-'));
  const filesDir = path.join(tmp, 'workspace');
  await fs.mkdir(path.join(filesDir, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(filesDir, 'notes.txt'),
    'Project codename: BLUE HERON\nLaunch date: 14 March\n',
  );
  await fs.writeFile(
    path.join(filesDir, 'package.json'),
    JSON.stringify({ name: 'red-kite', version: '3.4.5' }, null, 2),
  );
  await fs.writeFile(
    path.join(filesDir, 'src', 'greet.ts'),
    "export function greet(name: string) {\n  return 'Hello, ' + name;\n}\n",
  );

  const logger = createLogger({
    level: 'silent',
    logDir: config.logDir,
    sessionName: `eval-${testCase.name}`,
  });
  const longTermMemory = new LongTermMemory(path.join(tmp, 'data', 'memory.json'));
  const skillList: Skill[] = (testCase.skills ?? []).map((s) => ({ ...s, updatedAt: null }));
  const skills: SkillStore = {
    list: async () => skillList,
    get: async (name) => skillList.find((s) => s.name === name) ?? null,
  };
  const trackerTools = testCase.fakeMcp
    ? [
        defineTool<{ key: string }>({
          name: 'mcp__tracker__getIssue',
          description: 'Get one issue from the team tracker by its key, e.g. "APP-7".',
          properties: { key: { type: 'string', description: 'The issue key.' } },
          run: async ({ key }) =>
            `${key}: "Export button does nothing in Safari". Status: In progress.`,
        }),
        defineTool<{ query: string }>({
          name: 'mcp__tracker__searchIssues',
          description: 'Search the team tracker for issues matching some words.',
          properties: { query: { type: 'string', description: 'Words to search for.' } },
          run: async () => 'No issues found.',
        }),
      ]
    : [];
  const tasks = new BackgroundTasks();
  const makeAgent = () =>
    createAgent({
      config: { ...config, approval: 'auto' },
      model,
      logger,
      filesDir,
      longTermMemory,
      skills,
      extraTools: trackerTools,
      tasks: tasks.forWorkspace(filesDir),
    });
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const add = (u: Usage) => {
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
  };

  try {
    for (const prompt of testCase.priorSession ?? []) add((await makeAgent().run(prompt)).usage);
    const result = await makeAgent().run(testCase.prompt);
    add(result.usage);

    const failures: string[] = [];
    const output = result.text.replace(/,/g, '').toLowerCase();
    if (result.status !== 'done') failures.push(`run ended with status "${result.status}"`);
    for (const tool of testCase.expectTools ?? []) {
      if (!result.toolsUsed.includes(tool)) failures.push(`expected tool ${tool} to be used`);
    }
    for (const tool of testCase.forbidTools ?? []) {
      if (result.toolsUsed.includes(tool)) failures.push(`tool ${tool} should not have been used`);
    }
    for (const text of testCase.outputIncludes ?? []) {
      if (!output.includes(text.replace(/,/g, '').toLowerCase())) {
        failures.push(`answer should mention "${text}"`);
      }
    }
    for (const text of testCase.outputExcludes ?? []) {
      if (output.includes(text.toLowerCase())) failures.push(`answer should not mention "${text}"`);
    }
    if (testCase.checkFile) {
      try {
        const content = (
          await fs.readFile(path.join(filesDir, testCase.checkFile.path), 'utf8')
        ).toLowerCase();
        for (const text of testCase.checkFile.includes ?? []) {
          if (!content.includes(text.toLowerCase())) {
            failures.push(`${testCase.checkFile.path} should contain "${text}"`);
          }
        }
      } catch {
        failures.push(`${testCase.checkFile.path} was not created`);
      }
    }
    if (testCase.expectRunningTask && !tasks.list(filesDir).some((task) => task.isRunning)) {
      failures.push('expected a background task to still be running');
    }
    return { failures, result, usage };
  } catch (error) {
    return { failures: [`error: ${errorMessage(error)}`], result: null, usage };
  } finally {
    await tasks.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

out(`Running ${selected.length} eval case(s) on ${model.model}...\n`);
let passed = 0;
let totalTokens = 0;
for (const testCase of selected) {
  const { failures, result, usage } = await runCase(testCase);
  totalTokens += usage.inputTokens + usage.outputTokens;
  const ok = failures.length === 0;
  if (ok) passed += 1;
  const tools = result?.toolsUsed.length ? result.toolsUsed.join(', ') : 'none';
  out(`${ok ? 'PASS' : 'FAIL'}  ${testCase.name}  (tools: ${tools})`);
  for (const f of failures) out(`      - ${f}`);
  if (!ok && result) out(`      answer: ${result.text.slice(0, 300).replace(/\n/g, ' ')}`);
}
out(`\n${passed}/${selected.length} passed. Tokens used: ${totalTokens.toLocaleString()}.`);
process.exitCode = passed === selected.length ? 0 : 1;
