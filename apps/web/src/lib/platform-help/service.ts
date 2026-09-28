import 'server-only';
import { z } from 'zod';
import { helpContent, helpSearchInput, searchHelp } from './search';
import type { WorkspaceContext } from '@/lib/application/context';

type HelpAi = { run(model: string, input: { text: string[] }): Promise<unknown> };
type HelpIndex = { query(vector: number[], options: { topK: number; namespace: string; returnMetadata: 'none' }): Promise<unknown> };
const bindings = z.object({
  LUME_HELP_AI: z.custom<HelpAi>(value => value !== null && typeof value === 'object' && 'run' in value && typeof value.run === 'function'),
  LUME_HELP: z.custom<HelpIndex>(value => value !== null && typeof value === 'object' && 'query' in value && typeof value.query === 'function'),
});
const embedding = z.object({ data: z.array(z.array(z.number().finite()).length(1024)).length(1) });
const matches = z.object({ matches: z.array(z.object({ id: z.string(), score: z.number() })) });

export async function searchPlatformHelp(_context: WorkspaceContext, input: z.input<typeof helpSearchInput>) {
  let environment: z.output<typeof bindings> | undefined;
  try {
    const { env } = await import(/* webpackIgnore: true */ 'cloudflare:workers');
    const parsed = bindings.safeParse(env);
    if (parsed.success) environment = parsed.data;
  } catch { /* Node development uses the same manual with text retrieval. */ }
  const bound = environment;
  return searchHelp(input, bound ? async (query, limit, version) => {
    const work = async () => {
      const vector = embedding.parse(await bound.LUME_HELP_AI.run(helpContent.model, { text: [query] })).data[0];
      const result = matches.parse(await bound.LUME_HELP.query(vector, { topK: limit, namespace: version, returnMetadata: 'none' }));
      return result.matches.filter(match => match.score > 0.3).map(match => match.id);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Busca de ajuda excedeu o tempo disponível.')), 12_000); })]); }
    finally { clearTimeout(timer); }
  } : undefined);
}
