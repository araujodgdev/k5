import { z } from 'zod';
import { webReference } from './web-references';

const page = webReference.omit({ id: true }).extend({
  id: z.string().optional(), title: z.string().nullish(), text: z.string().nullish(),
}).transform(value => ({ ...value, id: value.id ?? value.url, title: value.title ?? value.url, text: value.text ?? '' }));
const envelope = z.object({ payload: z.unknown().optional() }).passthrough();
const result = z.object({ toolName: z.string(), result: z.unknown().optional(), output: z.unknown().optional() });
const pages = z.object({ results: z.array(z.unknown()).optional(), sources: z.array(z.unknown()).optional() });

function unwrap(value: unknown) {
  const parsed = envelope.safeParse(value);
  return parsed.success ? parsed.data.payload ?? value : value;
}

export function webStepSources(step: { sources?: unknown; toolResults?: unknown }) {
  const candidates: unknown[] = Array.isArray(step.sources) ? step.sources.map(unwrap) : [];
  for (const item of Array.isArray(step.toolResults) ? step.toolResults : []) {
    const tool = result.safeParse(unwrap(item));
    if (!tool.success || tool.data.toolName !== 'web_search') continue;
    const output = pages.safeParse(tool.data.result ?? tool.data.output);
    if (output.success) candidates.push(...output.data.results ?? [], ...output.data.sources ?? []);
  }
  return candidates.flatMap(candidate => {
    const parsed = page.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
}

export function recordedWebSources(step: Parameters<typeof webStepSources>[0]) {
  return webStepSources(step).map(source => ({ kind: 'web' as const, ref: source.url, url: source.url, title: source.title, text: source.text }));
}
