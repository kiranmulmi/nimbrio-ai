/** Names that aren't a file extension highlight.js knows. */
const BY_NAME: Record<string, string> = {
  dockerfile: 'bash',
  makefile: 'makefile',
  '.env': 'ini',
  '.gitignore': 'bash',
  '.npmrc': 'ini',
  '.editorconfig': 'ini',
};

/** Extensions highlight.js doesn't know by that name. */
const BY_EXTENSION: Record<string, string> = {
  mjs: 'javascript',
  cjs: 'javascript',
  mts: 'typescript',
  cts: 'typescript',
  htm: 'xml',
  svg: 'xml',
  vue: 'xml',
  svelte: 'xml',
  toml: 'ini',
  cfg: 'ini',
  conf: 'ini',
  env: 'ini',
  jsonc: 'json',
  jsonl: 'json',
  zsh: 'bash',
  mdx: 'markdown',
  h: 'c',
  hpp: 'cpp',
  cc: 'cpp',
  kt: 'kotlin',
  kts: 'kotlin',
};

/** The language to highlight a file as, from its name (null: show it as plain text). */
export function languageForPath(path: string): string | null {
  const name = (path.split(/[\\/]/).pop() ?? '').toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name] ?? null;
  if (name.startsWith('.env')) return 'ini';
  const dot = name.lastIndexOf('.');
  if (dot <= 0 && !name.startsWith('.')) return null;
  const extension = name.slice(dot + 1);
  return BY_EXTENSION[extension] ?? (extension || null);
}

/** "TypeScript" for a highlight.js name or alias, for a small label above code. */
export function languageLabel(language: string | null): string {
  if (!language) return 'Text';
  const labels: Record<string, string> = {
    ts: 'TypeScript',
    typescript: 'TypeScript',
    tsx: 'TSX',
    js: 'JavaScript',
    javascript: 'JavaScript',
    jsx: 'JSX',
    py: 'Python',
    python: 'Python',
    json: 'JSON',
    sh: 'Shell',
    bash: 'Shell',
    shell: 'Shell',
    yml: 'YAML',
    yaml: 'YAML',
    md: 'Markdown',
    markdown: 'Markdown',
    css: 'CSS',
    scss: 'SCSS',
    html: 'HTML',
    xml: 'XML',
    sql: 'SQL',
    go: 'Go',
    rs: 'Rust',
    rust: 'Rust',
    java: 'Java',
    rb: 'Ruby',
    ruby: 'Ruby',
    php: 'PHP',
    ini: 'Config',
    diff: 'Diff',
  };
  return labels[language] ?? language.toUpperCase();
}
