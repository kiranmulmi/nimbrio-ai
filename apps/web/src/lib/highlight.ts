// Syntax highlighting for code, loaded only when code is first shown (components/CodeHighlight).
// lowlight runs highlight.js's grammars and returns a syntax tree, which becomes React
// elements here, so code is never inserted as an HTML string.
import { toJsxRuntime, type Jsx } from 'hast-util-to-jsx-runtime';
import { common, createLowlight } from 'lowlight';
import { createElement, type ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

const lowlight = createLowlight(common);

type Tree = ReturnType<typeof lowlight.highlight>;
type TreeNode = Tree | Tree['children'][number];

/** A run of text and the classes of the spans around it, outermost first. */
interface Piece {
  text: string;
  classes: string[];
}

function collect(node: TreeNode, classes: string[], out: Piece[]): void {
  if (node.type === 'text') {
    out.push({ text: node.value, classes });
    return;
  }
  if (node.type === 'element') {
    const name = node.properties.className;
    const own = Array.isArray(name) ? name.join(' ') : typeof name === 'string' ? name : '';
    const inner = own ? [...classes, own] : classes;
    for (const child of node.children) collect(child, inner, out);
    return;
  }
  if (node.type === 'root') for (const child of node.children) collect(child, classes, out);
}

/** Past this, highlighting costs more than it helps (a bundle, a lockfile). */
const MAX_CHARS = 100_000;

/**
 * `code` highlighted as a whole (so a string or comment that spans lines stays coloured),
 * then split into one array of elements per line, for views that show lines one by one
 * (a diff). Null when the language is unknown.
 */
export function highlightLines(code: string, language: string): ReactNode[][] | null {
  if (code.length > MAX_CHARS || !lowlight.registered(language)) return null;
  let tree: Tree;
  try {
    tree = lowlight.highlight(language, code);
  } catch {
    return null;
  }
  const pieces: Piece[] = [];
  collect(tree, [], pieces);
  const lines: ReactNode[][] = [[]];
  let key = 0;
  for (const piece of pieces) {
    piece.text.split('\n').forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (!part) return;
      key += 1;
      // The same nesting as the original spans, so rules like `.hljs-class .hljs-title` apply.
      const element = piece.classes.reduceRight<ReactNode>(
        (child, className) => createElement('span', { className }, child),
        part,
      );
      lines[lines.length - 1]?.push(createElement('span', { key }, element));
    });
  }
  return lines;
}

/** `code` as coloured elements in `language` (a name or alias: ts, py, sh...), or null. */
export function highlight(code: string, language: string): ReactNode | null {
  if (code.length > MAX_CHARS || !lowlight.registered(language)) return null;
  try {
    return toJsxRuntime(lowlight.highlight(language, code), {
      Fragment,
      jsx: jsx as Jsx,
      jsxs: jsxs as Jsx,
    });
  } catch {
    return null;
  }
}
