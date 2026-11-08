import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import remarkGfm, { type Options as GfmOptions } from 'remark-gfm';
import { CodeHighlight } from './CodeHighlight';

// GitHub-flavoured Markdown: tables, ~~strikethrough~~, task lists, autolinked URLs. A single
// tilde stays literal, so "~5 min" isn't struck through.
const GFM: GfmOptions = { singleTilde: false };
const REMARK_PLUGINS: Options['remarkPlugins'] = [[remarkGfm, GFM]];

const COMPONENTS: Components = {
  // Links leave the app; the default URL check already drops javascript: and the like.
  a: ({ node: _node, href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  // Wide tables scroll sideways inside the answer instead of stretching it.
  table: ({ node: _node, children }) => (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  ),
  // Fenced blocks (they end in a newline) get JSON colouring; inline code stays as it is.
  code: ({ node: _node, className, children }) => {
    const text = String(children ?? '');
    const isBlock = Boolean(className) || text.endsWith('\n');
    if (!isBlock) return <code>{children}</code>;
    const language = /language-(\S+)/.exec(className ?? '')?.[1]?.toLowerCase() ?? null;
    return (
      <code className={className}>
        <CodeHighlight code={text.replace(/\n$/, '')} language={language} />
      </code>
    );
  },
  // Images in an answer would load from any server, so they show as a link to open instead.
  img: ({ node: _node, src, alt }) =>
    typeof src === 'string' && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer" className="image-link">
        {alt || src}
      </a>
    ) : null,
  // Task list boxes show the state; the answer isn't a form.
  input: ({ node: _node, type, checked }) =>
    type === 'checkbox' ? (
      <input type="checkbox" checked={Boolean(checked)} readOnly disabled />
    ) : null,
};

/**
 * Renders agent text as Markdown (CommonMark and GitHub's extensions) through react-markdown,
 * which builds React elements and shows any HTML in the text as plain text.
 */
export function Markdown({
  text,
  isStreaming = false,
  className = '',
}: {
  text: string;
  isStreaming?: boolean;
  className?: string;
}) {
  return (
    <div className={`markdown ${isStreaming ? 'is-streaming' : ''} ${className}`}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
