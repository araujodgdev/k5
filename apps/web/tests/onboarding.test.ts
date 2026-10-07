import assert from 'node:assert/strict';
import test from 'node:test';
import { tutorialSteps, type TutorialAccess } from '../src/lib/onboarding';

const everyone: TutorialAccess = { whatsappEnabled: false, adsEnabled: false, platformAdmin: false };
test('o tutorial aponta para o launcher e o chat persistente', () => {
  const steps = tutorialSteps(everyone);
  assert.equal(steps.find(step => step.id === 'navigation')?.target, '[data-tutorial="navigation"]');
  assert.equal(steps.find(step => step.id === 'agent')?.href, '/app/command-center');
  assert.equal(steps.find(step => step.id === 'agent')?.target, '[aria-label="Pergunte ao Lume"]');
  assert.match(steps.find(step => step.id === 'agent')!.description, /contexto original/);
});
test('o tutorial só oferece os módulos permitidos', () => {
  const ids = (access: TutorialAccess) => tutorialSteps(access).map(step => step.id);
  for (const id of ['whatsapp', 'ads', 'admin']) assert.equal(ids(everyone).includes(id), false);
  assert.equal(ids({ ...everyone, whatsappEnabled: true }).includes('whatsapp'), true);
  assert.equal(ids({ ...everyone, adsEnabled: true }).includes('ads'), true);
  assert.equal(ids({ ...everyone, platformAdmin: true }).includes('admin'), true);
  assert.equal(ids(everyone).at(-1), 'finish');
});
