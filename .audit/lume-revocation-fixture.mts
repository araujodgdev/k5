import { ApiSession } from '../apps/web/e2e/support/accounts.ts';

const api = await new ApiSession('http://localhost:62541').signIn({
  name: 'Proprietária da reprodução', officeName: 'Escritório da reprodução',
  email: 'lume-revocation-owner-20261007@k5.test', password: 'ReproLume!2026#Isolada',
});
const [action, caseId, userId] = process.argv.slice(2);
if (action === 'prepare') {
  const invitation = await api.json('/api/collaboration', { json: { action: 'invite', invitation: { email: 'verify@lume.test' } } });
  const result = await api.json('/api/vault/cases', { json: { name: 'Reprodução de acesso removido durante edição' } });
  console.log(JSON.stringify({ invitation, ...result }));
} else if (action === 'grant') {
  await api.json('/api/collaboration', { json: { action: 'participant', caseId, userId, add: true } });
  const result = await api.json(`/api/cases/${caseId}/pages`, { json: { title: 'Página para reproduzir revogação', content: 'Texto compartilhado da proprietária.' } });
  console.log(JSON.stringify(result));
} else if (action === 'revoke') {
  await api.json('/api/collaboration', { json: { action: 'participant', caseId, userId, add: false } });
  console.log(JSON.stringify({ revoked: true, caseId, userId }));
} else {
  throw new Error('Use prepare, grant <caseId> <userId> ou revoke <caseId> <userId>.');
}
