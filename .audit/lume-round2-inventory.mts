import { readFileSync, writeFileSync } from 'node:fs';
const path = new URL('./lume-provenance-files.json', import.meta.url);
const inventory = JSON.parse(readFileSync(path, 'utf8'));
inventory.round2 = {
  writer: 'GPT-6.1 Sol High / priority Fast; sole production writer',
  status: 'implemented; independent parent acceptance pending',
  runId: '20261006T234247-d88728',
  production: [
    'src/lib/documents/shared-writing.ts', 'src/lib/application/idempotency-service.ts', 'src/lib/application/capability-replay.ts',
    'src/lib/application/agent-settings-service.ts', 'src/lib/application/research-service.ts', 'src/lib/agent-tools/index.ts',
    'src/lib/capabilities/contracts.ts', 'src/lib/capabilities/annexes.ts', 'src/lib/capabilities/http-client.ts',
    'src/lib/collaboration/capability-access.ts', 'src/lib/application/context.ts', 'src/lib/application/annexes-service.ts',
    'src/lib/annexes.ts', 'src/components/vault-annexes.tsx', 'src/app/api/vault/cases/[id]/annexes/route.ts',
    'src/lib/knowledge/retrieval.ts', 'src/lib/citations/sources.ts', 'src/lib/citations/review.ts',
    'src/lib/google/gmail/service.ts', 'src/lib/google/operations.ts', 'src/lib/client-portal/service.ts',
    'src/lib/client-portal/invitations.ts', 'src/lib/client-portal/http.ts', 'src/app/api/client-portal/invitations/[token]/route.ts',
    'src/lib/chat-turn.ts', 'src/lib/auth-core.ts',
  ],
  testsAndBrowser: [
    'tests/source-round2.test.ts', 'tests/source-annex-plan.test.ts', 'tests/source-catalog-cache.test.ts', 'tests/source-gmail-binding.test.ts',
    'tests/client-portal.test.ts', 'tests/chat-source-boundary.test.ts', 'tests/shared-writing-fixture.ts', 'tests/security.test.ts',
    'tests/agent-profile.test.ts', 'tests/citations.test.ts', 'tests/auth.test.ts', 'tests/server-only-fixture.ts', 'e2e/annex-plan.e2e.ts', 'e2e/private-chat-readiness.e2e.ts', 'e2e/client-portal.e2e.ts',
  ],
  additiveMigrations: ['db/postgres/0083_retained_source_bindings.sql'],
  workspaceArtifacts: [
    '.audit/lume-source-boundary-census.mts', '.audit/lume-source-boundary-census.json',
    '.audit/lume-annex-browser-fixture.mts', '.audit/lume-round2-preview-setup.mts',
    '.audit/lume-round2-inventory.mts', '.audit/lume-source-round2-evidence.mts', '.audit/lume-round2-root-checks.mts',
    '.agents/skills/verify-lume/features/vault-annexes.md', '.claude/skills/verify-lume/features/vault-annexes.md',
    '.agents/skills/verify-lume/features/agent-chat.md', '.claude/skills/verify-lume/features/agent-chat.md',
  ],
  negativeEvidence: ['source-test-1791351730088', 'source-test-1791352050518'],
};
writeFileSync(path, JSON.stringify(inventory, null, 2) + '\n');
console.log(JSON.stringify({ round2Production: inventory.round2.production.length, round2Tests: inventory.round2.testsAndBrowser.length }));
