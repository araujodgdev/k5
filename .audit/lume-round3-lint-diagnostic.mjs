import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(resolve('apps/web/package.json'));
const { ESLint } = require('eslint');
const eslint = new ESLint({
  cwd: resolve('apps/web'),
  overrideConfig: { files: ['src/**/*.ts', 'src/**/*.tsx', 'scripts/**/*.ts', 'tests/**/*.ts', 'e2e/**/*.ts', 'e2e.config.ts'], rules: { '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }] } },
});
const results = await eslint.lintFiles(['.']);
const violations = results.flatMap(file => file.messages.filter(message => message.ruleId === '@typescript-eslint/no-misused-promises')
  .map(message => ({ path: file.filePath, line: message.line, message: message.message, messageId: message.messageId })));
await writeFile('.audit/lume-round3-lint-void-return.json', JSON.stringify({ at: new Date().toISOString(), violations }, null, 2));
console.log(JSON.stringify({ violations: violations.length, files: [...new Set(violations.map(item => item.path))].length, byMessage: Object.fromEntries([...new Set(violations.map(item => item.messageId))].map(id => [id, violations.filter(item => item.messageId === id).length])) }));
