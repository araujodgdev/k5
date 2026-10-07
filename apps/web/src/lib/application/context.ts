import 'server-only';
import { database, type Transaction } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityName } from '@/lib/capabilities/contracts';
import { caseAccess } from '@/lib/collaboration/access';
import { sharedCaseCapabilities } from '@/lib/collaboration/capability-access';

/** Trusted context, always built on the server from the session. The model never supplies these fields. */
export type WorkspaceContext = {
  userId: string;
  officeId: string;
  /** Server-resolved guest scope; never accepted from a browser or model. */
  caseScope?: { caseId: string; homeOfficeId: string };
  sessionId?: string;
  /** Set by server adapters, never read from capability inputs. */
  invocation?: 'agent' | 'webmcp';
  signal?: AbortSignal;
  agendaConfirmation?: { proposalId: string; hash: string };
  /** Selected by the person for this chat turn; model tools cannot enlarge this public-source scope. */
  allowedResearchCaseId?: string;
  allowedResearchReferenceIds?: string[];
  /** The chat conversation of this turn, set by the chat route; decides which documents are the agent's own. */
  conversationId?: string;
  submissionId?: string;
  generationId?: string;
  contentTransaction?: Transaction;
  contentSources?: import('@/lib/content-policy').ContentPolicy[];
  /** Pages the web search of this chat turn returned, filled by the chat as each step finishes. */
  consultedLinks?: ReadonlySet<string>;
  /**
   * Set by the chat's guard once this turn has read third-party text (e-mail, documents, web).
   * From then on an action the office allowed to run without confirmation asks for it.
   */
  untrustedContent?: { seen: boolean };
};

export function workspaceContext(workspace: {
  user: { id: string };
  office: { officeId: string };
  session?: { id?: string };
}): WorkspaceContext {
  return {
    userId: workspace.user.id,
    officeId: workspace.office.officeId,
    sessionId: workspace.session?.id,
  };
}

export async function assertWorkspaceSession(context: WorkspaceContext, db: Transaction = database) {
  context.signal?.throwIfAborted();
  if (context.sessionId) {
    const live = await db.prepare(`SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>clock_timestamp()${db === database ? '' : ' FOR SHARE'}`)
      .get(context.sessionId,context.userId);
    if (!live) throw new CapabilityError('UNAUTHENTICATED', 'Sua sessão foi encerrada. Entre novamente para continuar.');
  }
}

export async function assertCapabilityAllowed(context: WorkspaceContext, name: CapabilityName, db: Transaction = database) {
  await assertWorkspaceSession(context, db);

  if (context.invocation) {
    const caseId = context.caseScope?.caseId ?? context.allowedResearchCaseId;
    if (caseId) {
      await caseAccess(context.userId, caseId, db);
      await assertLumeAdmission(caseId, db);
    }
  }
  if (context.caseScope) {
    if (!sharedCaseCapabilities.has(name)) throw new CapabilityError('FORBIDDEN', 'Esta operação exige acesso ao escritório.');
    const access = await caseAccess(context.userId, context.caseScope.caseId, db);
    if (access.officeId !== context.officeId) throw new CapabilityError('FORBIDDEN', 'Sua participação não permite esta operação.');
    return context;
  }
  const current = await db.prepare('SELECT 1 FROM office_member WHERE user_id=? AND office_id=?').get(context.userId, context.officeId);
  if (!current) throw new CapabilityError('FORBIDDEN', 'Seu acesso a este escritório foi removido.');
  return context;
}

export async function assertLumeAdmission(caseId: string, db: Transaction = database) {
  const row = await db.prepare("SELECT c.lume_enabled AS enabled FROM vault_case c WHERE id=? AND deleted_at IS NULL").get<{ enabled: boolean }>(caseId);
  if (!row?.enabled) throw new CapabilityError('FORBIDDEN', 'O Lume não está disponível neste caso.');
}

export async function assertSourcesAdmitted(policy: import('@/lib/content-policy').ContentPolicy, db: Transaction = database) {
  if (!policy.guards.length) return;
  const cases = await db.prepare(`WITH guards AS (SELECT * FROM jsonb_to_recordset(?::jsonb) AS g(kind text,id text,"caseId" text))
    SELECT DISTINCT case_id FROM (
      SELECT CASE WHEN kind='case' THEN id ELSE "caseId" END AS case_id FROM guards
      UNION SELECT d.case_id FROM guards g JOIN vault_document d ON g.kind='document' AND d.id=g.id
    ) scope WHERE case_id IS NOT NULL`).all<{ case_id: string }>(JSON.stringify(policy.guards));
  for (const row of cases) await assertLumeAdmission(row.case_id, db);
}
