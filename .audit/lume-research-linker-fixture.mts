import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const pointer = JSON.parse(readFileSync(join(tmpdir(), 'lume-verify-current.json'), 'utf8'));
const state = JSON.parse(readFileSync(join(pointer.runDir, 'state.json'), 'utf8'));
assert.equal(state.runId, '20261006T234247-d88728');
assert.equal(state.port, 62541);
assert.equal(state.pgPort, 62542);
process.loadEnvFile(join(pointer.runDir, 'verify.env'));
process.env.DATABASE_URL = state.databaseUrl;
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const serverOnly = require.resolve('server-only');
require.cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as NodeJS.Module;
const { database: db, authStore } = await import('../apps/web/src/lib/database');
try {
  const rows = await db.prepare("SELECT j.id,j.title FROM research_judgment j JOIN research_material m ON m.judgment_id=j.id WHERE m.status='ready' AND j.status='active' ORDER BY j.collected_at DESC LIMIT 5").all();
  console.log(JSON.stringify(rows));
} finally { await (await authStore()).end(); }
