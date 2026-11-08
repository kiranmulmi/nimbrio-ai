// The file editor (CodeMirror 6), lazy-loaded by FilePreview when the user clicks Edit, so
// the editor and its language modes stay out of the main bundle.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  LanguageDescription,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/** Code colours: the same highlight.js classes (and CSS variables) the read-only view uses. */
const CODE_COLOURS = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], class: 'hljs-keyword' },
  { tag: [t.string, t.special(t.string), t.regexp], class: 'hljs-string' },
  { tag: [t.number, t.bool, t.null, t.atom], class: 'hljs-number' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'hljs-comment' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.heading], class: 'hljs-title' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.variableName)], class: 'hljs-type' },
  { tag: [t.propertyName, t.attributeName, t.definition(t.variableName)], class: 'hljs-attr' },
  { tag: [t.tagName, t.angleBracket], class: 'hljs-tag' },
  { tag: [t.meta, t.processingInstruction], class: 'hljs-meta' },
  { tag: t.inserted, class: 'hljs-addition' },
  { tag: t.deleted, class: 'hljs-deletion' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.link, textDecoration: 'underline' },
]);

/** The editor in the app's look: its fonts, colours and line numbers, light and dark. */
const THEME = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12.5px',
    color: 'var(--ink)',
    backgroundColor: 'var(--surface)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.625',
  },
  '.cm-content': { padding: '8px 0', caretColor: 'var(--ink)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)', borderLeftWidth: '2px' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface)',
    color: 'var(--ink-4)',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 16px 0 12px', minWidth: '56px' },
  '.cm-activeLine': { backgroundColor: 'var(--subtle)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--subtle)', color: 'var(--ink-2)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--accent-bg) !important',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--search-match)' },
  '.cm-searchMatch': { backgroundColor: 'var(--search-match)', borderRadius: '2px' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--search-current)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: 'none' },
  '.cm-panels': {
    backgroundColor: 'var(--subtle)',
    color: 'var(--ink-2)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12.5px',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line-2)' },
  '.cm-panel.cm-search': { padding: '6px 10px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    fontSize: '12px',
    borderRadius: '6px',
  },
  '.cm-textfield': {
    border: '1px solid var(--line)',
    backgroundColor: 'var(--surface)',
    color: 'var(--ink)',
    padding: '3px 6px',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--line)',
    color: 'var(--ink-2)',
  },
});

/**
 * Edits `initial` in place. Tells the parent about every change (`onChange`) and asks it to
 * save on ⌘S / Ctrl+S. Remount it (a new `key`) to load other text.
 */
export function CodeEditor({
  initial,
  path,
  isWrapped,
  onChange,
  onSave,
}: {
  initial: string;
  /** the file's path: picks the language */
  path: string;
  isWrapped: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const wrap = useRef(new Compartment());
  const language = useRef(new Compartment());
  // The editor is made once per mount from these; new text comes with a new `key`.
  const start = useRef({ text: initial, path, isWrapped });
  // The latest callbacks, read by the editor's handlers (which are created once).
  const handlers = useRef({ onChange, onSave });
  useLayoutEffect(() => {
    handlers.current = { onChange, onSave };
  }, [onChange, onSave]);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: start.current.text,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightSelectionMatches(),
          search({ top: true }),
          syntaxHighlighting(CODE_COLOURS),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                handlers.current.onSave();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          THEME,
          wrap.current.of(start.current.isWrapped ? EditorView.lineWrapping : []),
          language.current.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    editor.focus();

    // The language mode loads on its own (one small chunk per language).
    let isCurrent = true;
    const filePath = start.current.path;
    const name = filePath.slice(filePath.lastIndexOf('/') + 1);
    const description = LanguageDescription.matchFilename(languages, name);
    void description?.load().then((support) => {
      if (isCurrent) editor.dispatch({ effects: language.current.reconfigure(support) });
    });

    return () => {
      isCurrent = false;
      editor.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    view.current?.dispatch({
      effects: wrap.current.reconfigure(isWrapped ? EditorView.lineWrapping : []),
    });
  }, [isWrapped]);

  return <div ref={host} className="h-full" />;
}
