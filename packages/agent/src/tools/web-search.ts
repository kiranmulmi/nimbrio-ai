// Web search through a SearXNG instance (self-hosted metasearch).
// Needs the JSON format enabled in SearXNG's settings.yml:
//   search:
//     formats: [html, json]
import { z } from 'zod';
import { defineTool } from './define.js';
import { errorMessage } from '../errors.js';

const MAX_RESULTS = 8;
const TIMEOUT_MS = 15_000;

// SearXNG's reply, read leniently: a field of an unexpected type is treated as missing.
const optionalText = z.string().optional().catch(undefined);
const searxReply = z.object({
  results: z
    .array(
      z.object({
        title: optionalText,
        url: z.unknown(),
        content: optionalText,
        publishedDate: z.unknown(),
      }),
    )
    .catch([]),
  answers: z.array(z.unknown()).catch([]),
  infoboxes: z.array(z.object({ infobox: z.unknown(), content: optionalText })).catch([]),
  suggestions: z.array(z.unknown()).catch([]),
});

export const webSearch = defineTool<{ query: string; category: string; time_range: string }>({
  name: 'web_search',
  description:
    "Search the web and get the top results (title, link, snippet). Call this for anything that may have changed since your training: news, current office holders, prices, recent releases, today's events, or any fact you aren't sure of. Search before answering rather than guessing, and cite the links you used.",
  properties: {
    query: {
      type: 'string',
      description: 'Search terms, like you would type into a search engine.',
    },
    category: {
      type: 'string',
      enum: ['general', 'news'],
      description: 'Use "news" for recent events and headlines, otherwise "general".',
    },
    time_range: {
      type: 'string',
      enum: ['any', 'day', 'week', 'month', 'year'],
      description: 'Limit results to a recent period. Use "any" unless freshness matters.',
    },
  },
  async run({ query, category, time_range }, ctx) {
    if (!query.trim()) throw new Error('The search query is empty.');
    const baseUrl = ctx.searxngUrl;
    const url = new URL('/search', baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('categories', category);
    if (time_range !== 'any') url.searchParams.set('time_range', time_range);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError'
          ? `timed out after ${TIMEOUT_MS / 1000}s`
          : errorMessage(error);
      throw new Error(`Could not reach SearXNG at ${baseUrl} (${reason}).`, { cause: error });
    }
    if (response.status === 403) {
      throw new Error(
        'SearXNG refused the JSON request. Enable it in settings.yml under search.formats: [html, json].',
      );
    }
    if (!response.ok) throw new Error(`SearXNG returned HTTP ${response.status}.`);

    const data = searxReply.parse(await response.json());
    const results = data.results.slice(0, MAX_RESULTS).map((r, i) => {
      const lines = [`${i + 1}. ${r.title?.trim() || '(no title)'}`, `   ${String(r.url)}`];
      if (r.publishedDate) lines.push(`   published: ${String(r.publishedDate).slice(0, 10)}`);
      if (r.content) lines.push(`   ${r.content.replace(/\s+/g, ' ').trim()}`);
      return lines.join('\n');
    });

    const sections: string[] = [];
    const answers = data.answers
      .map((a) => (typeof a === 'string' ? a : answerText(a)))
      .filter(Boolean);
    if (answers.length)
      sections.push(`Direct answers:\n${answers.map((a) => `- ${a}`).join('\n')}`);
    for (const box of data.infoboxes.slice(0, 1)) {
      if (box.content) {
        sections.push(
          `Infobox (${String(box.infobox)}):\n${box.content.replace(/\s+/g, ' ').trim()}`,
        );
      }
    }
    sections.push(
      results.length
        ? `Results for "${query}":\n${results.join('\n\n')}`
        : `No results for "${query}". Try different or broader search terms.`,
    );
    if (data.suggestions.length) {
      sections.push(`Related searches: ${data.suggestions.slice(0, 5).join(' | ')}`);
    }
    return sections.join('\n\n');
  },
});

/** SearXNG gives answers as strings or as `{ answer: string, ... }` objects. */
function answerText(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'answer' in value) {
    return typeof value.answer === 'string' ? value.answer : '';
  }
  return '';
}
