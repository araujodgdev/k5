// Removes an account's acceptance of the terms, the state a version bump leaves behind. Sign-up
// records the acceptance and the UI cannot undo it, so the test writes it here. Argument: the e-mail.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
assert.ok(process.env.DATABASE_URL, 'E2E fixtures require DATABASE_URL from the test runner.');
const require = createRequire(new URL('../../package.json', import.meta.url));
const serverOnly = require.resolve('server-only');
require.cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as NodeJS.Module;
const { authStore, database: db } = await import('../../src/lib/database');
const [email] = process.argv.slice(2);
try {
  const result = await db.prepare(`DELETE FROM legal_acceptance WHERE document='terms' AND user_id=(SELECT id FROM "user" WHERE email=?)`).run(email);
  assert.equal(result.changes, 1, `no terms acceptance to remove for ${email}`);
} finally {
  await (await authStore()).end();
}
