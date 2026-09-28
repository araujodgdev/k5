import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import type { CitationSource } from './detect';

type Owner = { officeId: string; userId: string };
export type RecordedSource = Omit<CitationSource, 'id'> & { ref: string };

/** Keeps what a tool call showed the Lume, so its citations can be checked against it later. */
export async function recordSources(owner: Owner, conversationId: string, sources: RecordedSource[]) {
  const unique = [...new Map(sources.filter(source => source.ref).map(source => [`${source.kind}:${source.ref}`, source])).values()].slice(0, 60);
  if (!unique.length) return;
  await database.batch(unique.map(source => database.prepare(`INSERT INTO conversation_source(id,office_id,user_id,conversation_id,kind,ref,title,url,court,case_number,text)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM ai_conversation WHERE id=? AND office_id=? AND user_id=?)
    ON CONFLICT (conversation_id,kind,ref) DO UPDATE SET text=CASE WHEN length(excluded.text)>length(conversation_source.text) THEN excluded.text ELSE conversation_source.text END`)
    .bind(randomUUID(), owner.officeId, owner.userId, conversationId, source.kind, source.ref.slice(0, 1000), source.title.slice(0, 500),
      source.url ?? null, source.court ?? null, source.caseNumber ?? null, source.text.slice(0, 4000), conversationId, owner.officeId, owner.userId)));
}

export async function conversationSources(owner: Owner, conversationId: string | null | undefined): Promise<CitationSource[]> {
  if (!conversationId) return [];
  return await database.prepare(`SELECT id, kind, title, url, court, case_number AS "caseNumber", text FROM conversation_source
    WHERE office_id=? AND user_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT 200`).all(owner.officeId, owner.userId, conversationId) as CitationSource[];
}

/** Sources worth recording from a finished tool call; everything else is ignored. */
export function sourcesFromTool(name: string, result: unknown): RecordedSource[] {
  if (!result || typeof result !== 'object') return [];
  const value = result as Record<string, unknown>;
  // Scored case law backs citations only when its link came back from a search.
  if (name === 'k5_research_score_jurisprudence' && Array.isArray(value.results)) {
    return (value.results as Array<Record<string, unknown>>).flatMap(item => typeof item.url === 'string' && item.linkFound === true ? [{
      kind: 'web_jurisprudence' as const, ref: item.url, url: item.url, title: String(item.title ?? ''), court: String(item.court ?? '') || null,
      caseNumber: typeof item.caseNumber === 'string' ? item.caseNumber : null, text: [item.title, item.summary].filter(Boolean).join('\n'),
    }] : []);
  }
  if ((name === 'k5_knowledge_search') && Array.isArray(value.sources)) {
    return (value.sources as Array<Record<string, unknown>>).flatMap(item => typeof item.sourceId === 'string' ? [{
      kind: 'vault' as const, ref: item.sourceId, title: String(item.sourceLabel ?? ''), text: String(item.text ?? ''),
    }] : []);
  }
  if (name === 'k5_knowledge_get_source' && value.source && typeof value.source === 'object') {
    const item = value.source as Record<string, unknown>;
    return typeof item.sourceId === 'string' ? [{ kind: 'vault', ref: item.sourceId, title: String(item.sourceLabel ?? ''), text: [item.text, item.adjacentContext].filter(Boolean).join('\n') }] : [];
  }
  return [];
}
