import test from 'node:test';
import assert from 'node:assert/strict';
import { citationMarkdown } from '../src/lib/citations/web-references';
import { recordedWebSources } from '../src/lib/citations/web-step';

const source = { id: 'turn0search2', title: 'Fonte oficial', url: 'https://example.test/lei' };
test('provider citations become links only for exact source identifiers', () => {
  assert.equal(citationMarkdown('Fundamento. \uE200cite\uE202turn0search2\uE201', [source]), 'Fundamento. [Fonte 1](<https://example.test/lei>)');
  assert.equal(citationMarkdown('\uE200cite\uE202turn3view0\uE201', [source]), '(fonte não vinculada)');
  assert.equal(citationMarkdown('\uE200cite\uE202turn0search2\uE202turn3view0\uE201', [source]), '[Fonte 1](<https://example.test/lei>) (fonte não vinculada)');
  assert.equal(citationMarkdown('\uE200cite\uE202turn0search2\uE201', [{ ...source, url: 'javascript:alert(1)' }]), '(fonte não vinculada)');
});
test('partial markers never leak during streaming and ordinary Markdown is unchanged', () => {
  const marker = '\uE200cite\uE202turn0search2\uE201';
  for (let end = 1; end < marker.length; end++) assert.equal(citationMarkdown(`Texto ${marker.slice(0, end)}`, [source]), 'Texto ');
  assert.equal(citationMarkdown('**Texto** [site](https://example.test)'), '**Texto** [site](https://example.test)');
});
test('search steps preserve text and reject links from unrelated tool output', () => {
  const sources = recordedWebSources({ sources: [source], toolResults: [
    { toolName: 'web_search', result: { results: [{ ...source, text: 'Art. 113 do Código Civil.' }] } },
    { toolName: 'k5_artifacts_create', result: { sources: [{ ...source, url: 'https://invented.test' }] } },
  ] });
  assert.equal(sources.length, 2);
  assert.equal(sources[1].text, 'Art. 113 do Código Civil.');
  assert.equal(sources[0].text, '');
});
