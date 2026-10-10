import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import type { CitationSource } from './detect';
import type { z } from 'zod';
import { trademarkDetail, trademarkSearchView } from '@/lib/research/trademarks/contracts';
import { researchCapabilities } from '@/lib/capabilities/research';
import { assertPolicyAccess, combinePolicy, exposeContent, exposedPolicies, exposedSourcePolicies, parsePolicy, type ContentPolicy } from '@/lib/content-policy';
import { CapabilityError } from '@/lib/capabilities/errors';

type Owner = { officeId: string; userId: string };
export type RecordedSource = Omit<CitationSource, 'id'> & { ref: string; policy?: ContentPolicy };

/** Keeps what a tool call showed the Lume, so its citations can be checked against it later. */
export async function recordSources(owner: Owner, conversationId: string, sources: RecordedSource[]) {
  const unique = [...new Map(sources.filter(source => source.ref).map(source => [`${source.kind}:${source.ref}`, source])).values()].slice(0, 60);
  if (!unique.length) return;
  const admitted: (Omit<RecordedSource, 'policy'> & { policy: ContentPolicy | null })[] = [];
  for (const source of unique) {
    if (source.kind !== 'vault' && !source.policy) { admitted.push({ ...source, policy: null }); continue; }
    try {
      const policy = parsePolicy(source.policy);
      await assertPolicyAccess(owner.userId, policy);
      const pin = policy.observed.find(pin => pin.kind === (source.kind === 'vault' ? 'document' : 'research'));
      if (!pin && source.kind === 'vault') continue;
      const identity = pin ? `${pin.id}:${pin.version}:${pin.digest}` : `${policy.receipt}:${policy.digest}`;
      admitted.push({ ...source, ref: `${identity}:${source.ref}`, policy });
    } catch (error) { if (!(error instanceof CapabilityError)) throw error; }
  }
  await database.batch(admitted.map(source => database.prepare(`INSERT INTO conversation_source(id,office_id,user_id,conversation_id,kind,ref,title,url,court,case_number,text,content_policy)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?::jsonb WHERE EXISTS (SELECT 1 FROM ai_conversation WHERE id=? AND office_id=? AND user_id=?)
    ON CONFLICT (conversation_id,kind,ref) DO UPDATE SET text=CASE WHEN length(excluded.text)>length(conversation_source.text) THEN excluded.text ELSE conversation_source.text END`)
    .bind(randomUUID(), owner.officeId, owner.userId, conversationId, source.kind, source.ref.slice(0, 1000), source.title.slice(0, 500),
      source.url ?? null, source.court ?? null, source.caseNumber ?? null, source.text.slice(0, 64_000), source.policy ? JSON.stringify(source.policy) : null, conversationId, owner.officeId, owner.userId)));
}

export async function conversationSources(owner: Owner, conversationId: string | null | undefined): Promise<CitationSource[]> {
  if (!conversationId) return [];
  const rows = await database.prepare(`SELECT id, kind, ref, title, url, court, case_number AS "caseNumber", text,content_policy FROM conversation_source
    WHERE office_id=? AND user_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT 200`).all<CitationSource & { content_policy: unknown }>(owner.officeId, owner.userId, conversationId);
  const visible: CitationSource[] = [];
  for (const { content_policy, ...source } of rows as (CitationSource & { content_policy: unknown; ref: string })[]) {
    const catalog = source.kind === 'web_jurisprudence' && !content_policy && Boolean(await database.prepare(`SELECT 1 FROM research_material_version WHERE id=split_part(?,':',1)` ).get(source.ref));
    if (catalog) continue;
    if (source.kind === 'vault' || content_policy) {
      try { await assertPolicyAccess(owner.userId, parsePolicy(content_policy)); }
      catch (error) { if (error instanceof CapabilityError) continue; throw error; }
    }
    visible.push(content_policy ? exposeContent(source, [parsePolicy(content_policy)]) : source);
  }
  return visible;
}

type Judgment = z.output<typeof researchCapabilities.k5_research_search_corpus.output>['results'][number];

function judgmentSource(item: Judgment, texts: Array<string | null | undefined>, policies: ContentPolicy[]): RecordedSource {
  const text = texts.filter(Boolean).join('\n');
  return { kind: 'web_jurisprudence', ref: item.id, url: item.sourceUrl, title: item.title, court: item.tribunal, caseNumber: item.caseNumber, text,
    policy: combinePolicy(item.title, text, policies, 'generated') };
}

/** Sources worth recording from a finished tool call; everything else is ignored. */
export function sourcesFromTool(name: string, result: unknown): RecordedSource[] {
  if (!result || typeof result !== 'object') return [];
  const value = result as Record<string, unknown>;
  const policies = exposedSourcePolicies(result);
  if (name === 'k5_research_get_trademark' || name === 'k5_research_get_trademark_search' || name === 'k5_research_start_trademark_search' || name === 'k5_research_next_trademark_page') {
    const detail = trademarkDetail.safeParse(value.trademark);
    const search = trademarkSearchView.safeParse(value.search);
    const items = detail.success ? [detail.data] : search.success ? search.data.results : [];
    return items.map(item => ({ kind: 'web', ref: item.source.url, title: item.name || item.nativeId, url: item.source.url,
      text: [item.name, item.owner, item.situation, `Nice: ${item.niceClasses.join(', ')}`, `Viena: ${item.viennaCodes.join(', ')}`, `Fonte: ${item.source.provider}`, `Coletado: ${item.source.capturedAt}`,
        ...(detail.success ? detail.data.fields.map(field => `${field.label}: ${field.value}`) : [])].filter(Boolean).join('\n') }));
  }
  if (name === 'k5_research_score_jurisprudence' && Array.isArray(value.results)) {
    return (value.results as Array<Record<string, unknown>>).flatMap(item => typeof item.url === 'string' && item.linkFound === true ? [{
      kind: 'web_jurisprudence' as const, ref: item.url, url: item.url, title: String(item.title ?? ''), court: String(item.court ?? '') || null,
      caseNumber: typeof item.caseNumber === 'string' ? item.caseNumber : null, text: [item.title, item.summary].filter(Boolean).join('\n'),
      policy: combinePolicy(String(item.title ?? ''), [item.title, item.summary].filter(Boolean).join('\n'), exposedPolicies(result) ?? [], 'generated'),
    }] : []);
  }
  if (name === 'k5_research_web_search' || name === 'k5_research_get_web_search') {
    const parsed = researchCapabilities.k5_research_web_search.output.safeParse(value);
    return parsed.success ? parsed.data.search.results.map(item => ({ kind: 'web' as const, ref: item.url, url: item.url, title: item.title, text: item.excerpt })) : [];
  }
  if (name === 'k5_research_search_corpus' || name === 'k5_research_get_search' || name === 'k5_research_get_judgment') {
    const policies = exposedPolicies(result) ?? [];
    const corpus = researchCapabilities.k5_research_search_corpus.output.safeParse(value);
    if (corpus.success) return corpus.data.results.map(item => judgmentSource(item, [item.ementa], policies));
    const search = researchCapabilities.k5_research_get_search.output.safeParse(value);
    if (search.success) return search.data.search.pages.flatMap(page => page.results.map(item => judgmentSource(item, [item.ementa], policies)));
    const detail = researchCapabilities.k5_research_get_judgment.output.safeParse(value);
    if (!detail.success) return [];
    const { judgment } = detail.data;
    return [judgmentSource(judgment, [judgment.ementa, ...judgment.materials.filter(material => material.kind === 'full_text').map(material => material.version?.textContent)], policies)];
  }
  if ((name === 'k5_knowledge_search') && Array.isArray(value.sources)) {
    return (value.sources as Array<Record<string, unknown>>).flatMap(item => typeof item.sourceId === 'string' ? [{
      kind: item.sourceType === 'research' ? 'web_jurisprudence' as const : 'vault' as const,
      ref: item.sourceType === 'research' ? `${item.materialVersionId}:${item.researchChunkId}` : item.sourceId,
      policy: policies?.[item.sourceId], title: String(item.sourceLabel ?? ''), text: String(item.text ?? ''),
    }] : []);
  }
  if (name === 'k5_knowledge_get_source' && value.source && typeof value.source === 'object') {
    const item = value.source as Record<string, unknown>;
    return typeof item.sourceId === 'string' ? [{ kind: 'vault', ref: item.sourceId, policy: policies?.[item.sourceId], title: String(item.sourceLabel ?? ''), text: [item.text, item.adjacentContext].filter(Boolean).join('\n') }] : [];
  }
  return [];
}
