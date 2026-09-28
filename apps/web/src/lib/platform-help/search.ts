import { z } from 'zod';
import content from './content.json';
import { helpSearchInput, helpSearchOutput } from './contracts';
export { helpSearchInput, helpSearchOutput } from './contracts';

export const helpContent = z.object({ version: z.string(), model: z.literal('@cf/baai/bge-m3'), dimensions: z.literal(1024), sections: z.array(z.object({ id: z.string(), title: z.string(), content: z.string(), href: z.string() })) }).parse(content);

const stopwords = new Set(['como', 'para', 'pelo', 'pela', 'com', 'uma', 'uns', 'das', 'dos', 'que', 'qual', 'quais', 'posso', 'pode', 'lume', 'sobre', 'meu', 'minha', 'sistema', 'plataforma']);
const tokens = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2 && !stopwords.has(word));

export function textHelp(query: string, limit: number) {
  const words = [...new Set(tokens(query))];
  return helpContent.sections.map(section => {
    const title = tokens(section.title);
    const body = new Set(tokens(section.content));
    const score = words.reduce((score, word) => score + (title.includes(word) ? 5 : 0) + (body.has(word) ? 1 : 0), 0);
    return { section, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(item => item.section);
}

export type HelpSemanticSearch = (query: string, limit: number, version: string) => Promise<string[]>;

export async function searchHelp(raw: z.input<typeof helpSearchInput>, semantic?: HelpSemanticSearch) {
  const { query, limit } = helpSearchInput.parse(raw);
  let mode: 'semantic' | 'text' = 'text';
  let sections = textHelp(query, limit);
  if (semantic) {
    try {
      const ids = await semantic(query, limit, helpContent.version);
      const verified = [...new Set(ids)].flatMap(id => {
        const section = helpContent.sections.find(section => section.id === id);
        return section ? [section] : [];
      }).slice(0, limit);
      if (verified.length) { sections = verified; mode = 'semantic'; }
    } catch { /* The versioned local manual remains available when semantic search fails. */ }
  }
  return helpSearchOutput.parse({ version: helpContent.version, mode, degraded: mode === 'text', sources: sections.map(section => ({ id: section.id, title: section.title, text: section.content, href: section.href })) });
}
