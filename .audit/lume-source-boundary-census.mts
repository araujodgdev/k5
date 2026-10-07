import { readFileSync, writeFileSync } from 'node:fs';
const families = [
  { owner: 'capability replay', paths: ['src/lib/agent-tools/index.ts','src/lib/application/idempotency-service.ts','src/lib/application/capability-replay.ts','src/lib/application/agent-settings-service.ts','src/lib/application/research-service.ts','src/lib/capabilities/research-case.ts','src/lib/capabilities/contracts.ts'], pattern: /withIdempotency|captureCapabilityReplay|replayCapabilityResult|state='|replay_binding|recordToolProvenance|idempotencyKey|ReplayPolicies|materialVersionId|capabilityIdempotency/ },
  { owner: 'annex managed plan', paths: ['src/lib/annexes.ts','src/components/vault-annexes.tsx','src/lib/capabilities/annexes.ts','src/lib/application/annexes-service.ts','src/app/api/vault/cases/[id]/annexes/route.ts','src/lib/capabilities/http-client.ts'], pattern: /petitionText|analyzeAnnexes|generateAnnexes|scanDocumentId|planId|k5_vault_get_annex_plan/ },
  { owner: 'citation replay', paths: ['src/lib/citations/sources.ts','src/lib/knowledge/retrieval.ts','src/lib/citations/review.ts'], pattern: /policy: null|sourceType === 'research'|content_policy|observeResearch|researchPolicies|exposedPolicies|assertPolicyAccess/ },
  { owner: 'Gmail output and authorization binding', paths: ['src/lib/google/gmail/service.ts','src/lib/google/operations.ts'], pattern: /authorization_generation|seedId|reply && context.invocation|live.id !== row.connection_id/ },
  { owner: 'portal commit and invitation', paths: ['src/lib/client-portal/service.ts','src/lib/client-portal/invitations.ts','src/lib/client-portal/http.ts','src/lib/auth-core.ts','src/app/api/client-portal/invitations/[token]/route.ts'], pattern: /aclTransaction|aclReadTransaction|await authorize|clientAccess\(context|FOR UPDATE|FOR KEY SHARE|FOR SHARE|signal|assertWorkspaceSession|withPostgres/ },
  { owner: 'private source discovery', paths: ['src/lib/chat-turn.ts','src/lib/content-policy.ts'], pattern: /scopeDocuments|observeDocument|observeVaultFile|extracted_version !==/ },
  { owner: 'generation attempt lifecycle', paths: ['db/postgres/0076_content_policy.sql','db/postgres/0083_retained_source_bindings.sql','src/lib/office-deletion.ts','src/lib/application/conversations-service.ts','src/app/api/conversations/[id]/route.ts'], pattern: /content_generation_attempt|submission_id TEXT|approval_id TEXT|column_name = 'office_id'|DELETE FROM ai_conversation|deleteConversation/ },
];
const rows = families.map(({owner,paths,pattern}) => ({owner, paths: paths.map(path => ({ path: 'apps/web/'+path,
  sites: readFileSync(new URL('../apps/web/'+path, import.meta.url),'utf8').split(/\r?\n/).flatMap((line,index) => pattern.test(line) ? [{line:index+1,text:line.trim()}] : [])
}))}));
const result = { purpose: 'Bounded call-site census of the reported policy/context/version handoffs, not a completeness or vulnerability scanner.', rows };
writeFileSync(new URL('./lume-source-boundary-census.json', import.meta.url), JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(rows.map(row => ({owner:row.owner, paths:row.paths.length, matchedSites:row.paths.reduce((sum,path)=>sum+path.sites.length,0)}))));
