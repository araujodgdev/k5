import 'server-only';
import { database } from './database';
import { assertCapabilityAllowed, type WorkspaceContext } from './application/context';
import { getClient, getActivity } from './application/agenda-service';
import { getArtifact } from './application/artifacts-service';
import { getDocument } from './application/vault-service';
import { getPage } from './case-pages/service';
import { getCaseTask } from './case-tasks/service';
import { caseAccess, contextForCase, documentAccess } from './collaboration/access';
import { findVaultCase } from './vault';
import type { OfficeSearchHit } from './office-search-contract';

type Candidate = { id: string; kind: string; case_id: string | null };
export async function searchOffice(context: WorkspaceContext, query: string): Promise<{ hits: OfficeSearchHit[] }> {
  await assertCapabilityAllowed(context, 'k5_ui_open_resource');
  const q = query.trim();
  if (q.length < 2) return { hits: [] };
  const candidates = await database.prepare(`
    (SELECT id,'client' AS kind,NULL::text AS case_id FROM crm_client WHERE office_id=? AND strpos(lower(name),lower(?))>0 ORDER BY name,id LIMIT 20)
    UNION ALL (SELECT u.id,'associate',NULL FROM office_associate a JOIN "user" u ON u.id=a.user_id WHERE a.office_id=? AND strpos(lower(u.name || ' ' || u.email),lower(?))>0 ORDER BY u.name,u.id LIMIT 20)
    UNION ALL (SELECT c.id,'case',c.id FROM vault_case c WHERE deleted_at IS NULL AND strpos(lower(name),lower(?))>0 AND
      (office_id=? OR EXISTS(SELECT 1 FROM case_participant p WHERE p.case_id=c.id AND p.user_id=? AND p.revoked_at IS NULL)) ORDER BY updated_at DESC,id LIMIT 20)
    UNION ALL (SELECT id,'file',case_id FROM vault_document WHERE deleted_at IS NULL AND lume_vault_visible(id,?) AND strpos(lower(original_name),lower(?))>0 ORDER BY updated_at DESC,id LIMIT 20)
    UNION ALL (SELECT p.id,'page',p.case_id FROM case_page p JOIN vault_case c ON c.id=p.case_id WHERE c.deleted_at IS NULL AND strpos(lower(p.title),lower(?))>0
      AND (c.office_id=? OR EXISTS(SELECT 1 FROM case_participant m WHERE m.case_id=c.id AND m.user_id=? AND m.revoked_at IS NULL))
      AND (p.folder_id IS NULL OR vault_folder_visible(p.folder_id,?)) ORDER BY p.updated_at DESC,p.id LIMIT 20)
    UNION ALL (SELECT id,'draft',NULL FROM ai_artifact WHERE office_id=? AND user_id=? AND strpos(lower(title),lower(?))>0 ORDER BY updated_at DESC,id LIMIT 20)
    UNION ALL (SELECT id,'task',case_id FROM agenda_activity WHERE kind='task' AND lume_activity_visible(id,?) AND strpos(lower(title),lower(?))>0 ORDER BY updated_at DESC,id LIMIT 20)
  `).all<Candidate>(context.officeId,q,context.officeId,q,q,context.officeId,context.userId,context.userId,q,q,context.officeId,context.userId,context.userId,context.officeId,context.userId,q,context.userId,q);
  const hits: OfficeSearchHit[] = [];
  for (const item of candidates) {
    context.signal?.throwIfAborted();
    try {
      if (item.kind === 'client') {
        await assertCapabilityAllowed(context, 'k5_crm_get_client');
        const { client } = await getClient(context, { clientId: item.id });
        hits.push({ kind:'client',id:item.id,label:client.name,href:`/app/agenda/clients/${encodeURIComponent(item.id)}` });
      } else if (item.kind === 'associate') {
        await assertCapabilityAllowed(context, 'k5_collaboration_get');
        const person = await database.prepare('SELECT u.name FROM office_associate a JOIN "user" u ON u.id=a.user_id WHERE a.office_id=? AND u.id=?').get<{name:string}>(context.officeId,item.id);
        if (person) hits.push({kind:'associate',id:item.id,label:person.name,href:`/app/agenda?view=associates&associate=${encodeURIComponent(item.id)}`});
      } else if (item.kind === 'case') {
        const access = await caseAccess(context.userId,item.id);
        const record = await findVaultCase(access.officeId,item.id,context.userId);
        if (record) hits.push({kind:'case',id:item.id,label:record.name,href:`/app/vault/cases/${encodeURIComponent(item.id)}`});
      } else if (item.kind === 'file') {
        const scoped = await documentAccess(context,item.id);
        await assertCapabilityAllowed(scoped,'k5_vault_get_document');
        const { document } = await getDocument(scoped,{documentId:item.id});
        hits.push({kind:'document',documentKind:'file',id:item.id,label:document.name,href:`/app/vault/files/${encodeURIComponent(item.id)}`});
      } else if (item.kind === 'page' && item.case_id) {
        const { page } = await getPage(await contextForCase(context,item.case_id),{caseId:item.case_id,pageId:item.id});
        hits.push({kind:'document',documentKind:'page',id:item.id,label:page.title,href:`/app/vault/cases/${encodeURIComponent(item.case_id)}/pages/${encodeURIComponent(item.id)}`});
      } else if (item.kind === 'draft') {
        await assertCapabilityAllowed(context,'k5_artifacts_get');
        const { artifact } = await getArtifact(context,{artifactId:item.id});
        hits.push({kind:'document',documentKind:'draft',id:item.id,label:artifact.title,href:`/app/documents/${encodeURIComponent(item.id)}`});
      } else if (item.kind === 'task') {
        const task = item.case_id
          ? (await getCaseTask(await contextForCase(context,item.case_id),{caseId:item.case_id,activityId:item.id})).task
          : (await getActivity(context,{activityId:item.id})).activity;
        hits.push({kind:'task',id:item.id,label:task.title,href:item.case_id ? `/app/vault/cases/${encodeURIComponent(item.case_id)}?section=tasks&task=${encodeURIComponent(item.id)}` : `/app/agenda/tasks/${encodeURIComponent(item.id)}`});
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN'))) throw error;
    }
  }
  return { hits: hits.slice(0,50) };
}
