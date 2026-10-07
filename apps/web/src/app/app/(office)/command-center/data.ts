import 'server-only';
import { database } from '@/lib/database';
import { captureOperationalError } from '@/lib/observability/report';
import { listVaultCases, vaultCasePeopleByCase } from '@/lib/vault';
import type { LumeWork, OfficeCases } from '@/components/inicio/types';

const RECENT_CASES = 3;
const LUME_WORK = 3;

/** The cases most recently changed, with who works on them, and every case's name for the Hoje rows. */
export async function officeCases(officeId: string, userId: string): Promise<OfficeCases | null> {
  try {
    const cases = await listVaultCases(officeId, userId);
    const latest = cases.slice(0, RECENT_CASES);
    const people = await vaultCasePeopleByCase(officeId, latest.map((item) => item.id));
    return {
      recent: latest.map((item) => ({
        id: item.id, name: item.name, summary: item.description ?? item.client.name, updatedAt: item.updatedAt,
        people: (people[item.id] ?? []).map((person) => person.name),
      })),
      names: Object.fromEntries(cases.map((item) => [item.id, item.name])),
    };
  } catch (error) {
    captureOperationalError(error, 'inicio.cases');
    return null;
  }
}

const doneVerb = { draft: 'Redigiu a minuta', chronology: 'Montou a cronologia', document: 'Escreveu o documento' } as const;

/**
 * What the Lume wrote for this person since yesterday: documents from its runs and the ones it
 * created in a chat. Documents the person created by hand are theirs, not the Lume's.
 */
export async function lumeWork(officeId: string, userId: string): Promise<LumeWork[] | null> {
  try {
    const rows = await database.prepare(`SELECT id, kind, title, created_at AS "createdAt" FROM ai_artifact
      WHERE office_id=? AND user_id=? AND (run_id IS NOT NULL OR created_by_agent) AND created_at > now() - interval '2 days'
      ORDER BY created_at DESC, id LIMIT ?`).all<{ id: string; kind: keyof typeof doneVerb; title: string; createdAt: string }>(officeId, userId, LUME_WORK);
    return rows.map((row) => ({ id: row.id, text: `${doneVerb[row.kind] ?? doneVerb.document} ${row.title}`, at: row.createdAt }));
  } catch (error) {
    captureOperationalError(error, 'inicio.lume_work');
    return null;
  }
}
