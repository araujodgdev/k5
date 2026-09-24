import 'server-only';
import { createTool, webSearchTool } from '@mastra/core/tools';
import { z } from 'zod';
import { traceToolCall } from './observability/report';

/**
 * Web search for models without one of their own. OpenAI and Anthropic search inside the provider
 * (Mastra's webSearchTool); every other provider, Gemini included because Google Search does not
 * mix with function calling, gets this tool under the same name, backed by Exa.
 *
 * Only the query leaves the office. Page text comes back as untrusted data: the tool-result guard
 * checks it before the model reads it, and the chat records the URLs for the citation review.
 */
const EXA_SEARCH_URL = 'https://api.exa.ai/search';
const RESULTS = 6;
const PAGE_CHARACTERS = 2500;
export const NATIVE_WEB_SEARCH_PROVIDERS = new Set(['openai', 'anthropic']);

export const webPage = z.object({
  title: z.string(),
  url: z.string(),
  publishedDate: z.string().nullable(),
  text: z.string(),
});
export type WebPage = z.output<typeof webPage>;

const exaResponse = z.object({
  results: z.array(z.object({
    title: z.string().nullish(),
    url: z.string(),
    publishedDate: z.string().nullish(),
    text: z.string().nullish(),
  })),
});

export const exaApiKey = () => process.env.EXA_API_KEY?.trim() || undefined;

/** Exa's search modes offered to people: speed against depth. `deep` researches in several steps and takes longer. */
export const exaSearchTypes = ['instant', 'fast', 'auto', 'deep'] as const;
export type ExaSearchType = (typeof exaSearchTypes)[number];

export async function exaSearch(query: string, options: { apiKey: string; signal?: AbortSignal; numResults?: number; type?: ExaSearchType; fetch?: typeof fetch }): Promise<WebPage[]> {
  const type = options.type ?? 'auto';
  const response = await (options.fetch ?? fetch)(EXA_SEARCH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': options.apiKey },
    body: JSON.stringify({
      query, type, numResults: options.numResults ?? RESULTS,
      contents: { text: { maxCharacters: PAGE_CHARACTERS } },
    }),
    signal: AbortSignal.any([AbortSignal.timeout(type === 'deep' ? 120_000 : 30_000), ...(options.signal ? [options.signal] : [])]),
  });
  // The status is enough to diagnose; the body may echo the query.
  if (!response.ok) throw new Error(`Exa search failed with status ${response.status}.`);
  const parsed = exaResponse.parse(await response.json());
  return parsed.results.flatMap(result => {
    try {
      if (!/^https?:$/.test(new URL(result.url).protocol)) return [];
    } catch { return []; }
    return [{ title: result.title?.trim() || result.url, url: result.url, publishedDate: result.publishedDate ?? null, text: result.text?.trim() ?? '' }];
  });
}

export function exaWebSearchTool(apiKey: string) {
  return createTool({
    id: 'web_search',
    description: 'Pesquisa na web pública e devolve as páginas encontradas (título, link, data e trecho do texto). Use para fatos atuais e informações públicas que não estão no Cofre.',
    inputSchema: z.object({ query: z.string().trim().min(2).max(400).describe('Consulta de busca, com os termos que identificam o assunto.') }),
    outputSchema: z.object({ results: z.array(webPage) }),
    execute: async ({ query }, context) => ({ results: await traceToolCall('web_search', () => exaSearch(query, { apiKey, signal: context?.abortSignal })) }),
  });
}

/** The provider's own search when it has one, Exa when configured, otherwise no web search. */
export function webSearchFor(provider: string): Record<string, unknown> {
  if (NATIVE_WEB_SEARCH_PROVIDERS.has(provider)) return { web_search: webSearchTool };
  const apiKey = exaApiKey();
  return apiKey ? { web_search: exaWebSearchTool(apiKey) } : {};
}
