import { z } from 'zod';

export const webReference = z.object({
  id: z.string(),
  url: z.string().url().refine(url => /^https?:\/\//i.test(url)),
  title: z.string(),
});
export type WebReference = z.infer<typeof webReference>;

export function citationMarkdown(text: string, sources: readonly WebReference[] = []) {
  return text.replace(/\uE200cite\uE202([^\uE201]*)(?:\uE201|$)/g, (marker: string, ids: string) => {
    if (!marker.endsWith('\uE201')) return '';
    return [...new Set(ids.split('\uE202'))].map(id => {
      const index = sources.findIndex(source => source.id === id && /^https?:\/\//i.test(source.url));
      if (index < 0) return '(fonte não vinculada)';
      return `[Fonte ${index + 1}](<${sources[index].url.replace(/[<>\s]/g, encodeURIComponent)}>)`;
    }).join(' ');
  }).replace(/\uE200[^\uE201]*$/g, '');
}
