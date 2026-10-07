import assert from 'node:assert/strict';
import test from 'node:test';
import { tutorialSteps, type TutorialAccess, type TutorialStep } from '../src/lib/onboarding';

const everyone: TutorialAccess = { whatsappEnabled: false, adsEnabled: false, platformAdmin: false, canvasShell: false };
const byId = (steps: TutorialStep[]) => new Map(steps.map((step) => [step.id, step]));
const CHANGED = ['navigation', 'agent', 'finish'];

test('without the canvas shell the tour keeps the sidebar navigation and the Lume page', () => {
  const steps = byId(tutorialSteps(everyone));
  assert.deepEqual(steps.get('navigation'), {
    id: 'navigation', title: 'Cada área tem seu lugar', href: '/app/command-center', target: '[data-tutorial="navigation"]',
    description: 'Use o menu para mudar de módulo. No celular, Início, Lume, Cofre e Escritório ficam na barra inferior. As outras áreas ficam em Mais.',
  });
  assert.deepEqual(steps.get('agent'), {
    id: 'agent', title: 'Peça ajuda ao Lume', href: '/app/agents', target: '[aria-label="Pergunte ao Lume"]', module: 'agents',
    description: 'Escreva seu pedido ou anexe documentos. Peça consultas ao Cofre, organize tarefas ou redija uma minuta. Confira as fontes e revise o resultado. Ações que exigem confirmação aparecem na conversa.',
  });
  assert.match(steps.get('finish')!.description, /^Abra Tutorial no menu/);
});

test('with the canvas shell the navigation, Lume and closing steps point at the launcher and the panel', () => {
  const sidebar = tutorialSteps(everyone);
  const canvas = tutorialSteps({ ...everyone, canvasShell: true });
  assert.deepEqual(canvas.map((step) => step.id), sidebar.map((step) => step.id));

  const steps = byId(canvas);
  const agent = steps.get('agent')!;
  assert.equal(agent.href, '/app/command-center');
  assert.equal(agent.target, '#lume-panel');
  assert.equal(agent.title, 'Peça ajuda ao Lume');
  assert.equal(agent.module, 'agents');
  assert.match(agent.description, /painel ao lado de todas as telas/);
  assert.match(steps.get('navigation')!.description, /Casos e módulos/);
  assert.equal(steps.get('navigation')!.target, '[data-tutorial="navigation"]');
  assert.match(steps.get('finish')!.description, /Casos e módulos .*Mais opções/);
  assert.equal(steps.get('finish')!.target, '[data-tutorial="trigger"]');

  // Every other step is the same in both shells.
  const before = byId(sidebar);
  for (const step of canvas.filter((item) => !CHANGED.includes(item.id))) assert.deepEqual(step, before.get(step.id));
  for (const id of CHANGED) assert.notDeepEqual(steps.get(id), before.get(id));
});

test('WhatsApp, Anúncios and Administração appear only for those who have them, in either shell', () => {
  for (const canvasShell of [false, true]) {
    const base = { ...everyone, canvasShell };
    const ids = (access: TutorialAccess) => tutorialSteps(access).map((step) => step.id);
    for (const id of ['whatsapp', 'ads', 'admin']) assert.equal(ids(base).includes(id), false, `${id} sem acesso`);
    assert.equal(ids({ ...base, whatsappEnabled: true }).includes('whatsapp'), true);
    assert.equal(ids({ ...base, adsEnabled: true }).includes('ads'), true);
    assert.equal(ids({ ...base, platformAdmin: true }).includes('admin'), true);
    const all = ids({ ...base, whatsappEnabled: true, adsEnabled: true, platformAdmin: true });
    assert.equal(all.length, ids(base).length + 3);
    assert.equal(all.at(-1), 'finish');
  }
});
