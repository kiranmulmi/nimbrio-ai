// Lays out what goes inside the desktop app in apps/desktop/.stage, for electron-builder:
// the built API, web app and desktop main process at the same paths as in the repo (so every
// path they work out from their own location still holds), the internal packages in
// node_modules/@app, and only the production dependencies, pinned to the versions tested here.
// Run after `npm run build` (root) and `npm run build -w @app/desktop`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const STAGE = path.join(ROOT, 'apps/desktop/.stage');
const INTERNAL_PACKAGES = ['shared', 'agent', 'db'];
/** Whose dependencies the server needs at run time. */
const SERVER_MANIFESTS = ['apps/api', ...INTERNAL_PACKAGES.map((name) => `packages/${name}`)];

interface Manifest {
  version?: string;
  description?: string;
  dependencies?: Record<string, string>;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function requireBuilt(relative: string): void {
  if (!fs.existsSync(path.join(ROOT, relative))) {
    throw new Error(`${relative} is missing: run \`npm run build\` at the repo root first.`);
  }
}

/** The version npm installed for `name` here, so the app ships what the tests ran against. */
function installedVersion(name: string, fromWorkspace: string): string {
  for (const dir of [path.join(ROOT, fromWorkspace), ROOT]) {
    const manifest = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(manifest)) {
      const { version } = readJson<Manifest>(manifest);
      if (version) return version;
    }
  }
  throw new Error(`${name} isn't installed: run \`npm install\` at the repo root.`);
}

function runtimeDependencies(): Record<string, string> {
  const dependencies: Record<string, string> = {};
  for (const workspace of SERVER_MANIFESTS) {
    const manifest = readJson<Manifest>(path.join(ROOT, workspace, 'package.json'));
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (name.startsWith('@app/')) continue;
      dependencies[name] ??= installedVersion(name, workspace);
    }
  }
  return Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)));
}

/** Copies built output, leaving out source maps and type declarations. */
function copyBuilt(from: string, to: string): void {
  fs.cpSync(path.join(ROOT, from), path.join(STAGE, to), {
    recursive: true,
    filter: (source) => !source.endsWith('.map') && !source.endsWith('.d.ts'),
  });
}

function writeJson(relative: string, value: unknown): void {
  const file = path.join(STAGE, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

for (const built of [
  'apps/api/dist/index.js',
  'apps/web/dist/index.html',
  'apps/desktop/dist/main.js',
  ...INTERNAL_PACKAGES.map((name) => `packages/${name}/dist/index.js`),
]) {
  requireBuilt(built);
}

const root = readJson<Manifest>(path.join(ROOT, 'package.json'));
const desktop = readJson<Manifest>(path.join(ROOT, 'apps/desktop/package.json'));

const appManifest = {
  name: 'nimbrio-ai-desktop',
  productName: 'Nimbrio AI',
  version: root.version,
  description: desktop.description,
  private: true,
  type: 'module',
  main: 'apps/desktop/dist/main.js',
  dependencies: runtimeDependencies(),
};

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
writeJson('package.json', appManifest);

// Production dependencies only. The internal packages aren't listed yet: npm would look for
// @app/* on the public registry, where those names may belong to someone else.
execFileSync(
  'npm',
  ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-workspaces', '--no-package-lock'],
  { cwd: STAGE, stdio: 'inherit' },
);

// npm can drop the executable bit from node-pty's prebuilt spawn-helper, and the terminal then
// fails with "posix_spawnp failed". The API fixes it at run time, but it can't inside the
// signed, read-only app, so set it here before packing.
const ptyPrebuilds = path.join(STAGE, 'node_modules/node-pty/prebuilds');
for (const platform of fs.existsSync(ptyPrebuilds) ? fs.readdirSync(ptyPrebuilds) : []) {
  const helper = path.join(ptyPrebuilds, platform, 'spawn-helper');
  if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
}

copyBuilt('apps/api/dist', 'apps/api/dist');
copyBuilt('apps/web/dist', 'apps/web/dist');
copyBuilt('apps/desktop/dist', 'apps/desktop/dist');
writeJson('apps/api/package.json', { type: 'module' });
writeJson('apps/desktop/package.json', { type: 'module' });
const internal: Record<string, string> = {};
for (const name of INTERNAL_PACKAGES) {
  copyBuilt(`packages/${name}/dist`, `node_modules/@app/${name}/dist`);
  const manifest = path.join(ROOT, `packages/${name}/package.json`);
  fs.copyFileSync(manifest, path.join(STAGE, `node_modules/@app/${name}/package.json`));
  internal[`@app/${name}`] = readJson<Manifest>(manifest).version ?? '0.0.0';
}
// Now that they're in place, list them too: electron-builder packs only listed dependencies.
writeJson('package.json', {
  ...appManifest,
  dependencies: { ...internal, ...appManifest.dependencies },
});

process.stdout.write(`Staged the desktop app in ${path.relative(ROOT, STAGE)}\n`);
