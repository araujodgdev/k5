import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvalTitle, buildPlan, panelStatus, planSummary, showsPlan, splitSummary, type PlanPart } from '../src/components/lume-panel/plan';

const tool = (callId: string, name: string, summary: string, extra: Record<string, unknown> = {}): PlanPart =>
  ({ name: 'tool', data: { callId, name, summary, state: 'completed', ...extra } });

test('lume plan: each tool is one step, named by its action, in its module', () => {
  const plan = buildPlan([
    tool('a', 'k5_knowledge_search', 'Consultou os documentos do Cofre: 15 trechos'),
    tool('b', 'web_search', 'Pesquisou na web: vício construtivo'),
    tool('c', 'web_search', 'Pesquisou na web: art. 618'),
    tool('d', 'k5_artifacts_create', 'Criou o documento: Réplica', { href: '/app/documents/x' }),
    { name: 'text', data: 'ignored' },
  ]);
  assert.deepEqual(plan.steps.map(step => [step.module, step.title, step.detail, step.state, step.href ?? '']), [
    ['knowledge', 'Consultou os documentos do Cofre', '15 trechos', 'done', ''],
    ['web', 'Pesquisou na web', 'vício construtivo · art. 618', 'done', ''],
    ['artifacts', 'Criou o documento', 'Réplica', 'done', '/app/documents/x'],
  ]);
  assert.equal(plan.done, 3);
  assert.equal(planSummary(plan), '3 de 3 concluídas');
  assert.ok(showsPlan(plan));
});

test('lume plan: hidden plumbing, failures and partial failures', () => {
  const plan = buildPlan([
    tool('a', 'k5_tools_select_modules', ''),
    tool('b', 'k5_honorarios_list', 'Não foi possível consultar os honorários', { state: 'failed' }),
    tool('c', 'web_search', 'Pesquisou na web: um'),
    tool('d', 'web_search', 'Não foi possível pesquisar', { state: 'failed' }),
  ]);
  assert.deepEqual(plan.steps.map(step => [step.title, step.detail, step.state]), [
    ['Não foi possível consultar os honorários', '', 'failed'],
    ['Pesquisou na web', 'um · 1 falhou', 'done'],
  ]);
  assert.equal(planSummary(plan), '1 de 2 concluídas · 1 com falha');
});

test('lume plan: an approval waits for the person until decided', () => {
  const approval: PlanPart = { name: 'approval', data: { approvalId: 'p1', capability: 'k5_whatsapp_send', state: 'pending', summary: 'Enviar para Felipe no WhatsApp:\nOlá, Felipe!' } };
  const pending = buildPlan([tool('a', 'k5_crm_list_clients', 'Consultou os clientes: Felipe'), approval]);
  assert.deepEqual(pending.steps[1], { id: 'p1', module: 'whatsapp', title: 'Enviar para Felipe no WhatsApp', detail: 'Precisa de você: confirme abaixo', state: 'needs' });
  assert.equal(planSummary(pending), '1 de 2 concluídas · 1 precisa de você');
  assert.equal(panelStatus(pending, false), 'precisa de você');
  const confirmed = buildPlan([approval], { decisions: new Map([['p1', { state: 'confirmed' as const, result: 'Mensagem enviada' }]]) });
  assert.deepEqual([confirmed.steps[0].state, confirmed.steps[0].detail], ['done', 'Confirmado · Mensagem enviada']);
  assert.equal(panelStatus(confirmed, false), '');
});

test('lume plan: the running step comes last and does not count toward showing the card', () => {
  const plan = buildPlan([tool('a', 'k5_vault_list_cases', 'Consultou o Cofre: 3 casos')], { running: 'Atualizando a Agenda…' });
  assert.deepEqual(plan.steps.at(-1), { id: 'running', module: 'agenda', title: 'Atualizando a Agenda…', detail: '', state: 'running' });
  assert.equal(showsPlan(plan), false);
  assert.equal(panelStatus(plan, true), 'trabalhando · 1 de 2 tarefas');
  assert.equal(panelStatus(null, true), 'trabalhando');
});

test('lume plan: summaries and approval titles', () => {
  assert.deepEqual(splitSummary('Criou a reunião: Revisar, quinta: 10:00'), { title: 'Criou a reunião', detail: 'Revisar, quinta: 10:00' });
  assert.equal(approvalTitle('\nExcluir o caso Silva:\n'), 'Excluir o caso Silva');
  assert.equal(approvalTitle('x'.repeat(120)).length, 88);
});
