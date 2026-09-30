import { z } from 'zod';
import { helpContent } from '../src/lib/platform-help/search';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const index = process.env.LUME_HELP_INDEX ?? 'k5-platform-help-staging';
if (!account || !token) throw new Error('Configure CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN no ambiente do processo.');
if (!/^[a-z0-9_-]+$/.test(index)) throw new Error('Nome de índice inválido.');

async function api(method: string, path: string, body?: unknown, ndjson = false) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': ndjson ? 'application/x-ndjson' : 'application/json' },
    body: body === undefined ? undefined : ndjson && typeof body === 'string' ? body : JSON.stringify(body), signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Cloudflare respondeu ${response.status} para ${method} ${path}.`);
  const result = z.object({ success: z.boolean(), result: z.unknown() }).parse(await response.json());
  if (!result.success) throw new Error(`Cloudflare não concluiu ${method} ${path}.`);
  return result.result;
}

const configuration = z.object({ config: z.object({ dimensions: z.number(), metric: z.string() }) }).parse(await api('GET', `vectorize/v2/indexes/${index}`));
if (configuration.config.dimensions !== helpContent.dimensions || configuration.config.metric !== 'cosine') throw new Error('O índice precisa de 1024 dimensões e métrica cosine.');
const embedded = z.object({ data: z.array(z.array(z.number().finite()).length(1024)) });
for (let offset = 0; offset < helpContent.sections.length; offset += 10) {
  const sections = helpContent.sections.slice(offset, offset + 10);
  const { data } = embedded.parse(await api('POST', `ai/run/${helpContent.model}`, { text: sections.map(section => `${section.title}\n\n${section.content}`) }));
  if (data.length !== sections.length) throw new Error('Quantidade inesperada de embeddings.');
  const vectors = sections.map((section, i) => ({ id: section.id, namespace: helpContent.version, values: data[i], metadata: { title: section.title, version: helpContent.version } }));
  await api('POST', `vectorize/v2/indexes/${index}/upsert`, `${vectors.map(vector => JSON.stringify(vector)).join('\n')}\n`, true);
}
console.log(JSON.stringify({ index, version: helpContent.version, sections: helpContent.sections.length, status: 'submitted' }));
const ids = helpContent.sections.map(section => section.id);
let visible = false;
for (let attempt = 0; attempt < 12; attempt++) {
  const visibleIds = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += 20) {
    const rows = z.array(z.object({ id: z.string() })).parse(await api('POST', `vectorize/v2/indexes/${index}/get_by_ids`, { ids: ids.slice(offset, offset + 20) }));
    for (const row of rows) visibleIds.add(row.id);
  }
  if (ids.every(id => visibleIds.has(id))) { visible = true; break; }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
if (!visible) throw new Error('Publicação enviada, mas ainda não visível. Verifique o índice antes de liberar esta versão.');
console.log(JSON.stringify({ index, version: helpContent.version, status: 'verified' }));
