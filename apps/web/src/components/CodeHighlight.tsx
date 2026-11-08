import { useEffect, useMemo, useState } from 'react';
import { CodeText } from './CodeText';

type HighlightModule = typeof import('../lib/highlight');

// The highlighter is a separate chunk, loaded once, the first time code is shown.
let loaded: HighlightModule | null = null;
let loading: Promise<HighlightModule> | null = null;

/** The highlighter once it has loaded (null until then). */
export function useHighlighter(): HighlightModule | null {
  const [module, setModule] = useState(loaded);
  useEffect(() => {
    if (module) return;
    let isCurrent = true;
    loading ??= import('../lib/highlight');
    void loading.then((highlighter) => {
      loaded = highlighter;
      if (isCurrent) setModule(highlighter);
    });
    return () => {
      isCurrent = false;
    };
  }, [module]);
  return module;
}

/**
 * Code coloured for its language, for inside a `<pre>`/`<code>`. JSON keeps its own colours
 * (CodeText); other languages wait for the highlighter and show as plain text until then
 * or when the language is unknown.
 */
export function CodeHighlight({ code, language }: { code: string; language: string | null }) {
  const isJson = language === 'json' || language === 'jsonc';
  const highlighter = useHighlighter();
  const coloured = useMemo(
    () => (language && !isJson && highlighter ? highlighter.highlight(code, language) : null),
    [code, language, isJson, highlighter],
  );
  if (isJson || !language) return <CodeText text={code} language={language} />;
  return <>{coloured ?? code}</>;
}
