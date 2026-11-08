/** The colour class for a file's icon in the tree, and whether the file is noise to dim. */
export interface FileTint {
  icon: string;
  /** Lock files and the like: shown, but quieter than the files people edit. */
  isMuted: boolean;
}

const MUTED: FileTint = { icon: 'text-ink-4', isMuted: true };
const PLAIN: FileTint = { icon: 'text-ink-3', isMuted: false };

/** Whole names first: they win over the extension (package.json is npm, not JSON). */
const BY_NAME: Record<string, FileTint> = {
  'package.json': { icon: 'text-ft-npm', isMuted: false },
  'package-lock.json': MUTED,
  'yarn.lock': MUTED,
  'pnpm-lock.yaml': MUTED,
  'bun.lockb': MUTED,
  '.gitignore': MUTED,
  '.gitattributes': MUTED,
  '.npmrc': MUTED,
  '.ds_store': MUTED,
  dockerfile: { icon: 'text-ft-config', isMuted: false },
  makefile: { icon: 'text-ft-shell', isMuted: false },
  license: { icon: 'text-ft-doc', isMuted: false },
};

const BY_EXTENSION: Record<string, string> = {
  ts: 'text-ft-ts',
  tsx: 'text-ft-ts',
  mts: 'text-ft-ts',
  cts: 'text-ft-ts',
  js: 'text-ft-js',
  jsx: 'text-ft-js',
  mjs: 'text-ft-js',
  cjs: 'text-ft-js',
  json: 'text-ft-json',
  jsonc: 'text-ft-json',
  css: 'text-ft-style',
  scss: 'text-ft-style',
  sass: 'text-ft-style',
  less: 'text-ft-style',
  html: 'text-ft-markup',
  htm: 'text-ft-markup',
  xml: 'text-ft-markup',
  vue: 'text-ft-shell',
  svelte: 'text-ft-markup',
  md: 'text-ft-doc',
  mdx: 'text-ft-doc',
  txt: 'text-ink-3',
  rst: 'text-ft-doc',
  pdf: 'text-ft-npm',
  doc: 'text-ft-ts',
  docx: 'text-ft-ts',
  py: 'text-ft-python',
  ipynb: 'text-ft-python',
  sh: 'text-ft-shell',
  bash: 'text-ft-shell',
  zsh: 'text-ft-shell',
  ps1: 'text-ft-shell',
  yml: 'text-ft-config',
  yaml: 'text-ft-config',
  toml: 'text-ft-config',
  ini: 'text-ft-config',
  env: 'text-ft-config',
  conf: 'text-ft-config',
  lock: 'text-ink-4',
  png: 'text-ft-image',
  jpg: 'text-ft-image',
  jpeg: 'text-ft-image',
  gif: 'text-ft-image',
  webp: 'text-ft-image',
  svg: 'text-ft-image',
  ico: 'text-ft-image',
  csv: 'text-ft-data',
  tsv: 'text-ft-data',
  sql: 'text-ft-data',
  db: 'text-ft-data',
  sqlite: 'text-ft-data',
  go: 'text-ft-code',
  rs: 'text-ft-markup',
  java: 'text-ft-npm',
  kt: 'text-ft-style',
  rb: 'text-ft-npm',
  php: 'text-ft-config',
  c: 'text-ft-code',
  h: 'text-ft-code',
  cpp: 'text-ft-code',
  cs: 'text-ft-style',
  swift: 'text-ft-markup',
};

export function fileTint(fileName: string): FileTint {
  const name = fileName.toLowerCase();
  const named = BY_NAME[name];
  if (named) return named;
  // .env, .env.local, .env.example: configuration, whatever follows.
  if (name === '.env' || name.startsWith('.env.'))
    return { icon: 'text-ft-config', isMuted: false };
  if (name.startsWith('readme')) return { icon: 'text-ft-doc', isMuted: false };
  if (/^(tsconfig|jsconfig)(\..+)?\.json$/.test(name))
    return { icon: 'text-ft-ts', isMuted: false };
  if (/\.config\.[cm]?[jt]s$/.test(name)) return { icon: 'text-ft-config', isMuted: false };
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1) : '';
  const icon = BY_EXTENSION[extension];
  return icon ? { icon, isMuted: icon === 'text-ink-4' } : PLAIN;
}
