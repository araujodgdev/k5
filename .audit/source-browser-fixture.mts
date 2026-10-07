import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ApiSession } from '../apps/web/e2e/support/accounts';
const pointer = JSON.parse(readFileSync(join(tmpdir(), 'lume-verify-current.json'), 'utf8'));
const state = JSON.parse(readFileSync(join(pointer.runDir, 'state.json'), 'utf8'));
if (state.runId !== '20261006T234247-d88728' || state.port !== 62541 || state.pgPort !== 62542 || state.status !== 'ready') throw Error('Wrong instance');
const session = await new ApiSession(state.baseURL).signIn(state.account);
if (process.argv.includes('review') || process.argv.includes('continuation')) {
  process.env.DATABASE_URL = state.databaseUrl;
  const { setConversationMessages } = await import('../apps/web/e2e/support/seed');
  const { artifact } = await session.json<{artifact:{id:string;version:number}}>('/api/artifacts', { json: { title: 'Proposta exata no chat', content: 'Texto da proposta autenticada, revisado no chat antes de publicar no caso.' } });
  const { case: record } = await session.json<{case:{id:string}}>('/api/vault/cases', { json: { name: `Evidência de revisão ${Date.now()}` } });
  const caseId = record.id;
  const proposal = await session.json<{approvalId:string}>(`/api/cases/${caseId}/pages/publication`, { json: { artifactId: artifact.id, artifactVersion: artifact.version, folderId: null } });
  const { conversation } = await session.json<{ conversation: { id: string } }>('/api/conversations', { json: {} });
  await setConversationMessages(state.account.email, conversation.id, [{ id: 'manual-review-card', role: 'assistant', parts: [{ type: 'data-approval', data: { approvalId: proposal.approvalId, capability: process.argv.includes('continuation') ? 'k5_case_pages_create' : 'k5_case_pages_publish', summary: 'Resumo não autoritativo', state: 'pending' } }] }]);
  console.log(JSON.stringify({ conversationId: conversation.id, artifactId: artifact.id, approvalId: proposal.approvalId, fixture: 'real authenticated person publication proposal; chat card arranged in disposable DB; not live model generation' }));
  process.exit(0);
}
if (process.argv.includes('archive')) {
  process.env.DATABASE_URL = state.databaseUrl;
  const { seedConversationDocument } = await import('../apps/web/e2e/support/seed');
  const { conversation } = await session.json<{ conversation: { id: string } }>('/api/conversations', { json: {} });
  const artifactId = await seedConversationDocument(state.account.email, conversation.id, 'Arquivo particular — revisão de fontes', 'Texto de um artefato legado de modelo, preparado como fixture para verificar o arquivamento particular pela interface.');
  console.log(JSON.stringify({ conversationId: conversation.id, artifactId, fixture: 'legacy model document, database arrangement in owned isolated instance' }));
  process.exit(0);
}
const result = await session.json('/api/artifacts', { json: { title: 'Revisão de publicação — evidência', content: 'Texto pessoal criado pela API autenticada de documentos para verificar a revisão pela interface.' } });
console.log(JSON.stringify(result));
