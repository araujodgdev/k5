const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'lume-round3-comment-cleanup-applied.json'), 'utf8'));
const replacements = {
  'apps/web/src/lib/agent-instructions.ts': [['flat', 'encodeInstructionLine']],
  'apps/web/src/lib/agent-knowledge.ts': [['quoted', 'escapeKnowledgeDelimiters']],
  'apps/web/src/lib/application/approvals-service.ts': [['canonicalize', 'canonicalizeApprovalValue']],
  'apps/web/src/components/agent-chat.tsx': [['announce', 'openOrReloadFromToolStep']],
  'apps/web/src/lib/application/runs-service.ts': [['first', 'legacyModel']],
};
for (const item of plan.files) {
  const filename = path.join(root, item.path);
  let source = fs.readFileSync(filename, 'utf8');
  for (const [before, after] of replacements[item.path] ?? []) {
    const expression = new RegExp(`\\b${before}\\b`, 'g');
    if (!expression.test(source)) throw new Error(`Missing identifier ${item.path} ${before}`);
    source = source.replace(expression, after);
  }
  source = source.replace(/[\t ]+(?=\r?$)/gm, '').replace(/(\r?\n)(?:\r?\n){2,}/g, '$1$1');
  fs.writeFileSync(filename, source);
}
console.log(JSON.stringify({ files: plan.files.length, renamedFiles: Object.keys(replacements).length }));
