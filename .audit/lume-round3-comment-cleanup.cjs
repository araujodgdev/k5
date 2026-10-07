const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('../apps/web/node_modules/typescript');

const root = path.resolve(__dirname, '..');
const report = fs.readFileSync(path.join(__dirname, 'lume-provenance-round3-comments.md'), 'utf8');
const listing = report.split('```text')[1].split('```')[0];
const printer = ts.createPrinter({ removeComments: true });
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const plan = [];
for (const line of listing.trim().split(/\r?\n/)) {
  const match = /^(apps\/web\/[^:]+): (.+)$/.exec(line);
  if (!match) throw new Error(`Unexpected report entry: ${line}`);
  const relative = match[1];
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(root + path.sep)) throw new Error('Outside workspace');
  const before = fs.readFileSync(filename, 'utf8');
  const source = ts.createSourceFile(filename, before, ts.ScriptTarget.Latest, true);
  const lineStarts = source.getLineStarts();
  const selections = match[2].split(', ').map(range => {
    const [start, end = start] = range.split('-').map(Number);
    return { start: lineStarts[start - 1], end: lineStarts[end] ?? before.length, lines: range };
  });
  const comments = new Map();
  const visit = node => {
    for (const pos of [node.pos, node.end]) {
      for (const item of [...ts.getLeadingCommentRanges(before, pos) ?? [], ...ts.getTrailingCommentRanges(before, pos) ?? []])
        comments.set(item.pos, item);
    }
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  const selected = [...comments.values()].filter(item => selections.some(range => item.pos >= range.start && item.end <= range.end));
  for (const range of selections) {
    let remainder = before.slice(range.start, range.end);
    for (const item of selected.filter(item => item.pos >= range.start && item.end <= range.end).sort((a, b) => b.pos - a.pos))
      remainder = remainder.slice(0, item.pos - range.start) + remainder.slice(item.end - range.start);
    if (!selected.some(item => item.pos >= range.start && item.end <= range.end)) throw new Error(`No parsed comments at ${relative}:${range.lines}`);
    if (remainder.replace(/\{\s*\}/g, '').trim()) console.log(`Inline comment: ${relative}:${range.lines}`);
  }
  let after = before;
  for (const item of selected.sort((a, b) => b.pos - a.pos)) after = after.slice(0, item.pos) + after.slice(item.end);
  const parsed = ts.createSourceFile(filename, after, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length !== parsed.parseDiagnostics.length || printer.printFile(source) !== printer.printFile(parsed))
    throw new Error(`Parsed code changed: ${relative}`);
  plan.push({ path: relative, beforeHash: hash(before), afterHash: hash(after), tokens: selected.length, comments: selected.map(item => ({ start: item.pos, end: item.end, text: before.slice(item.pos, item.end) })), after });
}
const apply = process.argv.includes('--apply');
if (apply) {
  for (const item of plan) fs.writeFileSync(path.join(root, item.path), item.after);
  fs.writeFileSync(path.join(__dirname, 'lume-round3-comment-cleanup-applied.json'), JSON.stringify({ at: new Date().toISOString(), files: plan.map(({ after, ...item }) => item) }, null, 2));
}
console.log(JSON.stringify({ applied: apply, files: plan.length, comments: plan.reduce((sum, item) => sum + item.tokens, 0), parsedCodeUnchanged: true }));
