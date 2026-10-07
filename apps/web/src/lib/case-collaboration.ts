import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { aclTransaction } from '@/lib/acl-transaction';
import { documentTransaction } from '@/lib/documents/service';
import { assertCapabilityAllowed, assertWorkspaceSession, type WorkspaceContext } from '@/lib/application/context';
import { caseAccess } from '@/lib/collaboration/access';
import { CapabilityError } from '@/lib/capabilities/errors';
import { observePage } from '@/lib/content-policy';
import { findVaultDocument } from '@/lib/vault';
import { listHonorarios } from '@/lib/honorarios/service';

export const casePolicyInput = z.object({ enabled: z.boolean() }).strict();
export async function getCasePolicy(context: WorkspaceContext, caseId: string) {
  return documentTransaction(context, async tx => {
    await assertCapabilityAllowed(context,'k5_case_tasks_get',tx);
    const access = await caseAccess(context.userId,caseId,tx);
    const row = await tx.prepare('SELECT lume_enabled FROM vault_case WHERE id=?').get<{ lume_enabled: boolean }>(caseId);
    return { enabled: row!.lume_enabled, canManage: access.owner };
  });
}
export async function setCasePolicy(context: WorkspaceContext, caseId: string, raw: unknown) {
  const input = casePolicyInput.parse(raw);
  if (context.invocation) throw new CapabilityError('FORBIDDEN','Só a pessoa responsável pode alterar esta permissão na interface.');
  return aclTransaction(async tx => {
    await assertWorkspaceSession(context,tx);
    const access = await caseAccess(context.userId,caseId,tx);
    if (!access.owner) throw new CapabilityError('FORBIDDEN','Só o dono do caso pode alterar esta permissão.');
    const changed = await tx.prepare('UPDATE vault_case SET lume_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lume_enabled<>?')
      .run(input.enabled,caseId,input.enabled);
    if (changed.changes) await tx.prepare('INSERT INTO collaboration_audit(id,office_id,case_id,actor_user_id,action) VALUES(?,?,?,?,?)')
      .run(randomUUID(),access.officeId,caseId,context.userId,input.enabled ? 'lume.enabled' : 'lume.disabled');
    await assertWorkspaceSession(context,tx);
    return { enabled: input.enabled, canManage: true };
  });
}

export async function caseHonorarios(context: WorkspaceContext, caseId: string, query: { view?: 'pending' | 'received' | 'cancelled'; offset?: number } = {}) {
  await assertCapabilityAllowed(context,'k5_honorarios_list');
  await caseAccess(context.userId,caseId);
  const result = await listHonorarios(context,{ caseId, view:query.view ?? 'pending', offset:query.offset ?? 0, limit:50 });
  return { today: result.today, total: result.total, summary: result.summary, installments: result.installments.map(row => ({
    id: row.id, agreementId: row.agreementId, title: row.title, number: row.number, installmentCount: row.installmentCount,
    dueOn: row.dueOn, amountCents: row.amountCents, receivedCents: row.receivedCents, pendingCents: row.pendingCents,
    status: row.status, overdue: row.overdue, canManage: row.canManage,
  })) };
}
export type CaseActivity = { id: string; title: string; detail: string; at: string; href: string; actor?: string };
const auditCopy: Record<string,string> = { 'participant.added':'incluiu um participante', 'participant.removed':'removeu um participante',
  'lume.enabled':'permitiu que o Lume trabalhe no caso', 'lume.disabled':'desligou o Lume neste caso' };
export async function caseActivity(context: WorkspaceContext, caseId: string) {
  return documentTransaction(context, async tx => {
    await assertCapabilityAllowed(context,'k5_case_tasks_get',tx);
    const access = await caseAccess(context.userId,caseId,tx);
    const base = '/app/vault/cases/'+encodeURIComponent(caseId);
    const activity: CaseActivity[] = [];
    const versions = await tx.prepare(`SELECT v.page_id,v.version,v.title,v.created_at,u.name FROM case_page_version v
      JOIN case_page p ON p.id=v.page_id JOIN "user" u ON u.id=v.user_id WHERE p.case_id=? AND p.office_id=? ORDER BY v.created_at DESC LIMIT 100`)
      .all<{ page_id: string; version: number; title: string; created_at: string; name: string }>(caseId,access.officeId);
    for (const row of versions) {
      try { await observePage(context.userId,row.page_id,caseId,tx,row.version); }
      catch(error) { if (error instanceof CapabilityError && error.code==='NOT_FOUND') continue; throw error; }
      activity.push({ id:`page:${row.page_id}:${row.version}`,title:row.title, detail:`Página salva · versão ${row.version}`,
        at:String(row.created_at),actor:row.name,href:base+'/pages/'+encodeURIComponent(row.page_id) });
    }
    const audits = await tx.prepare(`SELECT a.id,a.action,a.created_at,u.name,t.name AS target FROM collaboration_audit a
      JOIN "user" u ON u.id=a.actor_user_id LEFT JOIN "user" t ON t.id=a.target_user_id
      WHERE a.office_id=? AND a.case_id=? ORDER BY a.created_at DESC LIMIT 100`)
      .all<{ id: string; action: string; created_at: string; name: string; target: string | null }>(access.officeId,caseId);
    for (const row of audits) if (auditCopy[row.action]) activity.push({ id:row.id,title:`${row.name} ${auditCopy[row.action]}`,
      detail:row.target ?? 'Permissão do caso',at:String(row.created_at),href:base+'?section=participants' });
    const files = await tx.prepare('SELECT id,created_at FROM vault_document WHERE case_id=? AND office_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100')
      .all<{ id: string; created_at: string }>(caseId,access.officeId);
    for (const row of files) {
      const file = await findVaultDocument(access.officeId,row.id,context.userId,tx);
      if (file) activity.push({ id:'file:'+file.id,title:file.name,detail:'Arquivo adicionado',at:String(row.created_at),href:'/app/vault/files/'+encodeURIComponent(file.id) });
    }
    const tasks = await tx.prepare(`SELECT a.id,a.title,a.status,a.created_at,a.updated_at,u.name FROM agenda_activity a
      JOIN "user" u ON u.id=a.created_by WHERE a.case_id=? AND a.office_id=? AND a.visibility='case' AND lume_activity_visible(a.id,?)
      ORDER BY a.updated_at DESC LIMIT 100`).all<{ id: string; title: string; status: string; created_at: string; updated_at: string; name: string }>(caseId,access.officeId,context.userId);
    const states: Record<string,string> = { pending:'Pendente',in_progress:'Em andamento',completed:'Concluída',cancelled:'Cancelada' };
    for (const row of tasks) {
      activity.push({ id:'task-created:'+row.id,title:row.title,detail:'Tarefa criada',at:String(row.created_at),actor:row.name,href:base+'?section=tasks&task='+encodeURIComponent(row.id) });
      if (row.updated_at !== row.created_at) activity.push({ id:'task-current:'+row.id,title:row.title,detail:'Estado atual · '+states[row.status],at:String(row.updated_at),href:base+'?section=tasks&task='+encodeURIComponent(row.id) });
    }
    activity.sort((a,b)=>b.at.localeCompare(a.at)||a.id.localeCompare(b.id));
    return { activity:activity.slice(0,100) };
  });
}
