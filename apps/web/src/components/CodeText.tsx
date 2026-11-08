import { useMemo } from 'react';
import { isJson, tokenizeJson } from '../lib/json-highlight';

/** Past this, colouring costs more than it helps (a lockfile, a big dump). */
const MAX_HIGHLIGHT_CHARS = 200_000;

/**
 * Text for a `<pre>`: JSON is coloured (when `language` says json, or when it parses as an
 * object or array), anything else is returned as is.
 */
export function CodeText({ text, language }: { text: string; language?: string | null }) {
  const tokens = useMemo(() => {
    if (text.length > MAX_HIGHLIGHT_CHARS) return null;
    const isJsonText = language === 'json' || language === 'jsonc' || isJson(text);
    return isJsonText ? tokenizeJson(text) : null;
  }, [language, text]);

  if (!tokens) return <>{text}</>;
  return (
    <>
      {tokens.map((token, index) =>
        token.kind === 'plain' ? (
          token.text
        ) : (
          <span key={index} className={`json-${token.kind}`}>
            {token.text}
          </span>
        ),
      )}
    </>
  );
}
