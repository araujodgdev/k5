import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REPEATS, MAX_TOOL_CALLS, ToolBudget } from '../src/lib/agent-budget';

/** The shape the provider's web search reached the chat with in production: empty input, the query in the result. */
const search = (query: string) => ({ action: { type: 'search', query, queries: [query] }, sources: [{ type: 'url', url: 'https://stj.jus.br/x' }] });

test('tool budget: different provider searches are not repeats, although their input is always empty', () => {
  const budget = new ToolBudget();
  const actions = [search('site:stj.jus.br cirurgia rede privada urgência'), { action: { type: 'openPage', url: 'https://web.trf3.jus.br/acordao/1' } },
    search('site:tjpi.jus.br cirurgia rede privada Estado'), search('site:tjdft.jus.br cirurgia urgência')];
  actions.forEach((result, i) => {
    budget.called(`ws_${i}`, {}, true);
    assert.equal(budget.finished(`ws_${i}`, 'web_search', result), null, `search ${i} goes on`);
  });
});

test('tool budget: the same search, or the same call to our tools, stops after the allowed repeats', () => {
  const budget = new ToolBudget();
  let stop = null;
  for (let i = 0; i <= MAX_REPEATS && !stop; i++) {
    budget.called(`ws_${i}`, {}, true);
    stop = budget.finished(`ws_${i}`, 'web_search', search('mesma consulta'));
  }
  assert.equal(stop?.reason, 'repeated');

  const ours = new ToolBudget();
  for (let i = 0; i < MAX_REPEATS; i++) { ours.called(`c${i}`, { query: 'a' }, false); assert.equal(ours.finished(`c${i}`, 'k5_knowledge_search', {}), null); }
  ours.called('c9', { query: 'a' }, false);
  assert.equal(ours.finished('c9', 'k5_knowledge_search', {})?.reason, 'repeated');
});

test('tool budget: our tools keep their limit; provider searches have their own', () => {
  const budget = new ToolBudget();
  for (let i = 0; i < 20; i++) { budget.called(`ws_${i}`, {}, true); assert.equal(budget.finished(`ws_${i}`, 'web_search', search(`consulta ${i}`)), null); }
  let stop = null;
  for (let i = 0; i < MAX_TOOL_CALLS && !stop; i++) { budget.called(`c${i}`, { i }, false); stop = budget.finished(`c${i}`, 'k5_knowledge_search', {}); }
  assert.equal(stop?.reason, 'budget');
});
