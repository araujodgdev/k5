import type { Browser } from '@e2e-dev/web';
import type { Screen } from 'e2e';

type Fixtures = { screen: Screen; browser: Browser };

export async function showCanvas({ screen }: Fixtures) {
  const collapse = screen.getByRole('button', 'Recolher o Lume', { visible: true });
  if (await collapse.isVisible()) await collapse.tap();
}

export async function showLume({ screen }: Fixtures) {
  const back = screen.getByRole('button', 'Voltar ao Lume');
  if (await back.isVisible()) await back.tap();
  else {
    const pill = screen.getByRole('button', /^Pedir ao Lume/);
    if (await pill.isVisible()) await pill.tap();
    else await screen.getByRole('button', 'Abrir o Lume', { exact: true }).tap();
  }
}

export async function openModules(fixtures: Fixtures) {
  const mobile = await fixtures.browser.evaluate(() => window.innerWidth < 768);
  if (mobile) await showCanvas(fixtures);
  await fixtures.screen.getByRole('button', mobile ? /^Mais opções(?:,|$)/ : 'Casos e módulos', { visible: true }).tap();
}

export async function openAccount(fixtures: Fixtures) {
  const mobile = await fixtures.browser.evaluate(() => window.innerWidth < 768);
  if (mobile) await showCanvas(fixtures);
  await fixtures.screen.getByRole('button', mobile ? /^Mais opções(?:,|$)/ : /^Conta de /, { visible: true }).tap();
}

export async function startLogout(fixtures: Fixtures) {
  await openAccount(fixtures);
  const mobile = await fixtures.browser.evaluate(() => window.innerWidth < 768);
  await fixtures.screen.getByRole(mobile ? 'button' : 'menuitem', 'Sair', { exact: true }).tap();
}
