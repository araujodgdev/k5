import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

/**
 * In Tailwind 4, `outline-none` sets `--tw-outline-style: none`, and `focus-visible:outline-2` only
 * sets the width over `outline-style: var(--tw-outline-style)`. Together in one class list the focus
 * ring never shows. A list that also sets the style on focus (`focus-visible:outline-solid`) is fine.
 */
const WEB = join(import.meta.dirname, '..');
const SOURCE = join(WEB, 'src');
const OUTLINE_STYLES = new Set(['outline-solid', 'outline-dashed', 'outline-dotted', 'outline-double']);

type Token = { variants: string[]; utility: string };

function tokenOf(raw: string): Token {
  const parts = raw.replace(/^!|!$/g, '').split(':');
  return { variants: parts.slice(0, -1), utility: parts.at(-1) ?? '' };
}

/** True when the class list hides the outline and then draws a focus ring that inherits the hidden style. */
function hidesFocusRing(classes: string): boolean {
  const tokens = classes.split(/\s+/).filter(Boolean).map(tokenOf);
  const hidden = tokens.some((token) => token.utility === 'outline-none');
  const ring = tokens.filter((token) => token.variants.includes('focus-visible') && token.utility.startsWith('outline-') && token.utility !== 'outline-none');
  return hidden && ring.length > 0 && !ring.some((token) => OUTLINE_STYLES.has(token.utility));
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

/** Every string literal of a file, a template literal's static parts joined as one, with its line. */
function literalsOf(path: string): { line: number; text: string }[] {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: { line: number; text: string }[] = [];
  const at = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) found.push({ line: at(node), text: node.text });
    else if (ts.isTemplateExpression(node)) found.push({ line: at(node), text: [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ') });
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test('the rule flags outline-none with a focus-visible outline and spares lists that restore the style', () => {
  assert.equal(hidesFocusRing('rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-ring'), true);
  assert.equal(hidesFocusRing('outline-none md:focus-visible:outline-offset-2'), true);
  assert.equal(hidesFocusRing('outline-none focus-visible:ring-2 focus-visible:ring-ring'), false);
  assert.equal(hidesFocusRing('focus-visible:outline-2 focus-visible:outline-ring'), false);
  assert.equal(hidesFocusRing('outline-none focus-visible:outline-solid focus-visible:outline-2'), false);
  assert.equal(hidesFocusRing('outline-none'), false);
});

test('no class list in src hides the focus ring it draws', () => {
  const offenders = sourceFiles(SOURCE).flatMap((path) => literalsOf(path)
    .filter((literal) => hidesFocusRing(literal.text))
    .map((literal) => `${relative(WEB, path).replaceAll('\\', '/')}:${literal.line}`));
  assert.deepEqual(offenders, [], `outline-none hides the focus-visible outline in:\n${offenders.join('\n')}`);
});
