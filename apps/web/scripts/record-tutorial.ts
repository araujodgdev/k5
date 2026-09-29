import { chromium, expect as playwrightExpect, type Page, type Locator } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const expect = playwrightExpect.configure({ timeout: 60_000 });

const baseURL = process.env.TUTORIAL_BASE_URL ?? 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) throw new Error('A gravação exige um ambiente demo local.');
const output = resolve('../tutorials/public/recordings');
mkdirSync(output, { recursive: true });
const evidence = resolve('.data/tutorial/frames');
mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch();
const clientName = 'Ana Costa · Demo';
const caseName = 'Ana Costa · Revisão contratual';
type Cue = { title: string; text: string; start: number; end: number };

async function click(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) { await target.page().mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 }); await target.page().waitForTimeout(180); }
  await target.click();
}
async function fill(target: Locator, text: string) { await click(target); await target.fill(text); }

async function chapter(id: string, title: string, route: string, run: (page: Page, cue: (text: string, action?: () => Promise<void>, duration?: number) => Promise<void>) => Promise<void>, published = false) {
  const selected = process.argv.find(arg => arg.startsWith('--only='))?.slice(7).split(',');
  if (selected && !selected.includes(id)) return;
  const manifestPath = resolve(output, `${id}.json`);
  if (existsSync(manifestPath) && !process.argv.includes('--force')) { console.log(`Reutilizando ${id}`); return; }
  const context = await browser.newContext({ storageState: `.data/tutorial/${published ? 'deploy-' : ''}session.json`, viewport: { width: 1440, height: 810 }, recordVideo: { dir: resolve('.data/tutorial/raw'), size: { width: 1440, height: 810 } }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const pointer = document.createElement('div');
      pointer.id = 'tutorial-cursor';
      pointer.style.cssText = 'position:fixed;left:720px;top:405px;width:24px;height:32px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 2px 3px #0008)';
      pointer.innerHTML = '<svg viewBox="0 0 24 32"><path d="M2 2L2 26L9 20L14 30L19 27L14 18L23 18Z" fill="white" stroke="#232323" stroke-width="2"/></svg>';
      document.documentElement.append(pointer);
      document.addEventListener('pointermove', event => { pointer.style.left = `${event.clientX}px`; pointer.style.top = `${event.clientY}px`; }, true);
      document.addEventListener('pointerdown', event => {
        const ring = document.createElement('div');
        ring.style.cssText = `position:fixed;left:${event.clientX - 20}px;top:${event.clientY - 20}px;width:40px;height:40px;border:3px solid #d97757;border-radius:50%;pointer-events:none;z-index:2147483646;background:#d9775733`;
        document.documentElement.append(ring);
        ring.animate([{ transform: 'scale(.4)', opacity: 1 }, { transform: 'scale(1.8)', opacity: 0 }], { duration: 700 }).onfinish = () => ring.remove();
      }, true);
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const origin = Date.now();
  const cues: Cue[] = [];
  const video = page.video();
  const cue = async (text: string, action?: () => Promise<void>, duration = 6) => {
    const start = (Date.now() - origin) / 1000;
    if (action) await action();
    await page.waitForTimeout(Math.max(1200, duration * 1000 - (Date.now() - origin - start * 1000)));
    const end = (Date.now() - origin) / 1000;
    cues.push({ title, text, start, end });
    await page.screenshot({ path: resolve(evidence, `${id}-${cues.length}.png`) });
    console.log(`${id} ${cues.length}: ${text}`);
  };
  try {
    await page.goto(`${published ? 'https://k5-staging.k5-web.workers.dev' : baseURL}${route}`);
    await page.locator('#main-content').waitFor();
    await page.waitForTimeout(1800);
    await expect(page.getByText(/^Carregando/)).toHaveCount(0, { timeout: 90_000 });
    await run(page, cue);
    await context.close();
    if (!video) throw new Error('Gravação indisponível.');
    await video.saveAs(resolve(output, `${id}.webm`));
    writeFileSync(manifestPath, JSON.stringify({ id, title, file: `recordings/${id}.webm`, cues }, null, 2));
  } catch (error) {
    await page.screenshot({ path: resolve(evidence, `${id}-failure.png`) });
    console.error((await page.locator('body').innerText()).slice(-6000));
    await context.close();
    throw error;
  }
}

try {
  await chapter('01-inicio', 'Início e navegação', '/app/command-center', async (page, cue) => {
    await cue('Bem-vindo ao Lume. Este tutorial usa um escritório demonstrativo e dados fictícios.');
    await cue('No Início, acompanhe tarefas, reuniões, casos e clientes. O menu abre cada módulo.', async () => { await page.mouse.move(140, 150, { steps: 20 }); });
    await cue('O Tutorial acompanha você pelas telas. Use Próximo, Voltar ou saia para continuar depois.', async () => {
      await click(page.getByRole('button', { name: 'Tutorial do Lume' }));
      await click(page.getByRole('button', { name: /Começar tutorial|Continuar tutorial/ }));
      await click(page.getByRole('button', { name: 'Próximo', exact: true }));
    }, 8);
    await page.keyboard.press('Escape');
  });
  await chapter('02-clientes', 'Escritório · Clientes', '/app/agenda?view=clients', async (page, cue) => {
    const existing = page.getByRole('link', { name: clientName, exact: true }).first();
    const hasClient = await existing.count() > 0;
    await cue('Em Escritório, abra Clientes para cadastrar um contato ou editar sua ficha.', async () => {
      if (hasClient) { await click(existing); await click(page.getByRole('button', { name: /Editar/ }).first()); }
      else await click(page.getByRole('button', { name: 'Novo cliente', exact: true }));
    });
    await cue('Preencha nome, contato e relacionamento. As áreas jurídicas ajudam a filtrar a lista.', async () => {
      await fill(page.getByLabel('Nome', { exact: true }), clientName);
      await fill(page.getByLabel('E-mail', { exact: true }), 'ana.costa@example.test');
      await page.getByLabel('Relacionamento', { exact: true }).selectOption('active');
      await page.getByLabel('Cível', { exact: true }).check();
    }, 8);
    await cue('Salve o cadastro. Abra a ficha para consultar os dados, casos e atividades do cliente.', async () => {
      await click(page.getByRole('button', { name: 'Salvar', exact: true }));
      await expect(page.getByRole('dialog')).toHaveCount(0);
      if (!hasClient) await click(page.getByRole('link', { name: clientName, exact: true }).first());
      await expect(page.getByRole('heading', { name: clientName })).toBeVisible();
    }, 8);
  });
  await chapter('03-cofre', 'Cofre · Casos e documentos', '/app/vault', async (page, cue) => {
    await cue('No Cofre, a Biblioteca guarda materiais gerais. Crie um caso para reunir os arquivos de um atendimento.', async () => {
      await click(page.getByRole('button', { name: 'Novo caso', exact: true }));
      await fill(page.getByLabel('Título', { exact: true }), caseName);
      await fill(page.getByLabel('Descrição', { exact: true }), 'Exemplo fictício para o tutorial: revisão de contrato de prestação de serviços.');
    }, 8);
    await cue('Abra o caso criado. As abas separam arquivos, referências e participantes.', async () => {
      await click(page.getByRole('button', { name: 'Criar caso', exact: true }));
      await click(page.getByRole('link').filter({ hasText: caseName }).first());
      await expect(page.getByRole('button', { name: 'Enviar arquivos', exact: true })).toBeVisible();
    }, 7);
    await cue('Envie um documento e acompanhe seu processamento. Use pastas para organizar o material.', async () => {
      const chooser = page.waitForEvent('filechooser');
      await click(page.getByRole('button', { name: 'Enviar arquivos', exact: true }));
      await (await chooser).setFiles({ name: 'Contrato demonstrativo.txt', mimeType: 'text/plain', buffer: Buffer.from('DOCUMENTO FICTÍCIO PARA DEMONSTRAÇÃO\nCliente: Ana Costa\nObjeto: revisão de contrato de prestação de serviços.\nHonorários acordados: R$ 3.000,00 em três parcelas de R$ 1.000,00.\nA reunião de revisão ocorrerá após a análise do contrato.\nNenhum dado deste arquivo corresponde a um caso real.') });
      await expect(page.getByText('Contrato demonstrativo.txt', { exact: true })).toBeVisible();
    }, 8);
    await cue('Em Participantes, compartilhe somente este caso. Confira o papel antes de conceder acesso.', async () => { await click(page.getByRole('button', { name: 'Participantes', exact: true })); });
  });
  await chapter('04-tarefas', 'Escritório · Tarefas e agenda', '/app/agenda?view=tasks', async (page, cue) => {
    await cue('Em Tarefas, crie uma atividade com título, situação, responsável e data.', async () => {
      await click(page.getByRole('button', { name: 'Nova atividade', exact: true }));
      await fill(page.getByLabel('Título', { exact: true }), 'Revisar contrato da Ana · Demo');
      await page.getByLabel('Responsável', { exact: true }).selectOption({ label: 'Marina Oliveira' });
      await page.getByLabel('Caso do Cofre').selectOption({ label: caseName });
      await click(page.getByRole('button', { name: 'Salvar', exact: true }));
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }, 9);
    await cue('O Kanban organiza as tarefas por situação. Concluídas ficam disponíveis em Arquivadas.', async () => {
      await click(page.getByRole('button', { name: 'Kanban', exact: true }));
      await page.waitForTimeout(1000);
    });
    await cue('Na Agenda, crie uma reunião e informe o horário de início e de fim.', async () => {
      await click(page.getByRole('button', { name: 'Agenda', exact: true }));
      await click(page.getByRole('button', { name: 'Nova atividade', exact: true }));
      await fill(page.getByLabel('Título', { exact: true }), 'Reunião com Ana · Demo');
      await page.getByLabel('Tipo', { exact: true }).selectOption('meeting');
      await click(page.getByRole('button', { name: 'Salvar', exact: true }));
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }, 9);
    await cue('Selecione um dia para consultar os compromissos. A agenda Google pessoal é uma conexão separada.');
  });
  await chapter('05-honorarios', 'Honorários · Parcelas e recebimentos', '/app/honorarios', async (page, cue) => {
    await cue('Em Honorários, clique em Novo honorário e escolha o cliente do acordo.', async () => {
      await click(page.getByRole('button', { name: 'Novo honorário', exact: true }));
      await page.getByRole('dialog').getByLabel('Cliente', { exact: true }).selectOption({ label: clientName });
      await fill(page.getByRole('dialog').getByLabel('Descrição', { exact: true }), 'Revisão contratual · Demo');
    }, 7);
    await cue('Informe valor, número de parcelas e primeiro vencimento. Confira a divisão antes de cadastrar.', async () => {
      await fill(page.getByLabel('Valor total (R$)', { exact: true }), '3000,00');
      await fill(page.getByLabel('Número de parcelas'), '3');
      await fill(page.getByLabel('Primeiro vencimento'), '2026-10-10');
      await click(page.getByRole('button', { name: 'Cadastrar honorário', exact: true }));
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await click(page.getByRole('button', { name: 'Abrir Revisão contratual · Demo, parcela 1 de 3', exact: true }).first());
      await expect(page.getByRole('heading', { name: 'Revisão contratual · Demo', exact: true })).toBeVisible();
    }, 9);
    await cue('Registre um recebimento na parcela correspondente. O lançamento é interno e não cobra o cliente.', async () => {
      await click(page.getByRole('button', { name: /Registrar recebimento/ }).first());
      await page.getByLabel('Meio de recebimento').selectOption('pix');
      await click(page.getByRole('button', { name: 'Salvar recebimento', exact: true }));
      await expect(page.getByLabel('Meio de recebimento')).toHaveCount(0);
    }, 8);
    await cue('Os totais mostram o valor recebido e o saldo. O histórico preserva os registros e as correções.');
  });
  await chapter('06-lume', 'Lume · Assistente e documentos', '/app/agents', async (page, cue) => {
    await click(page.getByRole('button', { name: 'Nova conversa', exact: true }));
    // Keep existing conversation titles out of this public tutorial.
    const historyToggle = page.getByRole('button', { name: 'Ocultar conversas', exact: true });
    if (await historyToggle.isVisible()) await click(historyToggle);
    await cue('No Lume, descreva o que precisa. Você pode anexar arquivos ou selecionar fontes do Cofre.', async () => {
      await fill(page.getByRole('textbox', { name: 'Pergunte ao Lume' }), 'Demonstração do tutorial: crie um documento com o título Roteiro de atendimento demonstrativo. Escreva dois parágrafos curtos sobre uma reunião fictícia de revisão contratual com Ana Costa. Não consulte dados do escritório nem a web. Use apenas dados fictícios e identifique o documento como demonstração.');
      await click(page.getByRole('button', { name: 'Enviar mensagem', exact: true }));
    }, 8);
    await expect(page.getByRole('button', { name: 'Copiar resposta' }).last()).toBeVisible({ timeout: 240_000 });
    await cue('A resposta chega na conversa. Confira o resultado e revise o documento antes de utilizá-lo.', undefined, 8);
    const editor = page.getByRole('link', { name: 'Exportar DOCX', exact: true });
    if (await editor.isVisible()) {
      const exportPath = await editor.getAttribute('href');
      const artifactId = exportPath?.match(/^\/api\/artifacts\/([^/]+)\/export$/)?.[1];
      if (artifactId) writeFileSync('.data/tutorial/document-url.txt', `/app/documents/${artifactId}`);
      await cue('O documento abre ao lado do chat. Edite o texto, consulte versões e exporte em DOCX.', async () => {
        const download = page.waitForEvent('download');
        await click(editor);
        await (await download).saveAs(resolve('.data/tutorial/documento-demonstrativo.docx'));
      }, 8);
    } else {
      await cue('Você pode continuar a conversa para ajustar o texto. Confira fontes e citações antes de finalizar.', undefined, 7);
    }
  }, true);
  if (existsSync('.data/tutorial/document-url.txt')) {
    const documentPath = readFileSync('.data/tutorial/document-url.txt', 'utf8').replace(/^\uFEFF/, '').trim();
    if (!/^\/app\/documents\/[a-zA-Z0-9-]+$/.test(documentPath)) throw new Error('Referência de documento inválida.');
    await chapter('06b-documento', 'Documentos · Revisão e exportação', documentPath, async (page, cue) => {
      await expect(page.getByRole('link', { name: 'Exportar DOCX', exact: true })).toBeVisible();
      await cue('O editor salva as alterações. A aba Revisão ajuda a conferir o texto e suas referências.', async () => { await click(page.getByRole('tab', { name: /Revisão/ })); }, 6);
      await cue('Consulte as versões e use Exportar DOCX para baixar o documento e continuar seu trabalho.', async () => {
        await click(page.getByRole('tab', { name: 'Editar', exact: true }));
        const download = page.waitForEvent('download');
        await click(page.getByRole('link', { name: 'Exportar DOCX', exact: true }));
        await (await download).saveAs(resolve('.data/tutorial/documento-demonstrativo.docx'));
      }, 7);
    }, true);
  }
  await chapter('07-pesquisa', 'Pesquisa · Busca e histórico', '/app/research', async (page, cue) => {
    await cue('Na Pesquisa, escreva uma questão e escolha o tipo de busca: instantânea, rápida, automática ou profunda.', async () => {
      await fill(page.getByLabel('O que você quer pesquisar?', { exact: true }), 'STJ contrato de prestação de serviços boa-fé objetiva');
      await click(page.getByText('Rápida', { exact: true }));
      await click(page.locator('form').getByRole('button', { name: 'Pesquisar', exact: true }));
    }, 7);
    await expect(page.getByRole('heading', { name: /resultado/i })).toBeVisible({ timeout: 120_000 });
    await cue('Os resultados trazem links e trechos. Abra a fonte e confira o conteúdo antes de citar.', undefined, 7);
    await cue('O Histórico guarda suas consultas. Reabra uma pesquisa para consultar os resultados sem pesquisar novamente.', async () => {
      await click(page.getByRole('button', { name: 'Histórico', exact: true }));
    });
  }, true);
  await chapter('08-email', 'E-mails · Gmail conectado', '/app/email', async (page, cue) => {
    await expect(page.getByRole('button', { name: 'Escrever', exact: true }).filter({ visible: true })).toBeVisible({ timeout: 90_000 });
    await page.addStyleTag({ content: '[aria-label="Lista de e-mails"] { filter: blur(7px); }' });
    await cue('Com o Google conectado, use as pastas e a busca do Gmail. Mensagens pessoais estão desfocadas nesta gravação.', async () => {
      await fill(page.getByRole('textbox', { name: 'Buscar e-mails' }), 'subject:"Tutorial demonstrativo Lume"');
      await click(page.getByRole('button', { name: 'Buscar', exact: true }));
    }, 7);
    await cue('Clique em Escrever. Preencha destinatário, assunto e mensagem; revise tudo antes de enviar.', async () => {
      await click(page.getByRole('button', { name: 'Escrever', exact: true }).filter({ visible: true }));
      await fill(page.getByLabel('Para', { exact: true }), 'ana.costa@example.test');
      await fill(page.getByLabel('Assunto', { exact: true }), 'Tutorial demonstrativo Lume');
      await fill(page.getByLabel('Mensagem', { exact: true }), 'Olá, Ana. Este é um exemplo fictício para demonstrar a preparação de uma mensagem no Lume.');
    }, 9);
    await cue('Você pode anexar arquivos ou salvar um rascunho. Este exemplo será fechado sem enviar.', async () => {
      await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(1800);
      await click(page.getByRole('button', { name: 'Fechar', exact: true }));
    }, 7);
  }, true);
  await chapter('09-mensagens', 'Mensagens · Conversas e compartilhamentos', '/app/messages', async (page, cue) => {
    await cue('Mensagens reúne conversas e compartilhamentos do Cofre. Comece em Nova conversa.', async () => {
      await click(page.getByRole('button', { name: 'Nova conversa', exact: true }));
    });
    await cue('Busque uma pessoa ou informe o e-mail completo. Confira o destinatário antes de continuar.', async () => {
      await fill(page.getByRole('textbox', { name: 'Nome ou e-mail' }), 'Pedro Lima');
      await click(page.getByRole('button', { name: /Pedro Lima · Demo/ }));
    });
    await cue('Escreva e envie a mensagem. Compartilhar do Cofre permite enviar documentos com controle de acesso.', async () => {
      await fill(page.getByPlaceholder('Escreva uma mensagem'), 'Olá, Pedro. Esta é uma conversa fictícia para o tutorial do Lume.');
      await click(page.getByRole('button', { name: 'Enviar', exact: true }));
      await expect(page.getByText('Olá, Pedro. Esta é uma conversa fictícia para o tutorial do Lume.', { exact: true }).last()).toBeVisible();
    }, 7);
    await page.keyboard.press('Escape');
  });
  await chapter('10-equipe', 'Escritório · Equipe e convites', '/app/agenda?view=team', async (page, cue) => {
    await cue('Administradores gerenciam a Equipe. Cada membro recebe um papel: administrador, advogado ou revisor.', async () => { await click(page.getByRole('button', { name: 'Convidar para equipe', exact: true })); });
    await cue('Use Associados para parceiros e Convites para acompanhar os acessos. Compartilhe apenas o necessário.');
    await page.keyboard.press('Escape');
  });
  await chapter('11-integracoes', 'Integrações · Google e WhatsApp', '/app/integrations', async (page, cue) => {
    await expect(page.getByRole('heading', { name: 'Conta Google', exact: true })).toBeVisible({ timeout: 90_000 });
    await cue('Em Integrações, autorize Gmail, Agenda, Drive e Docs. As conexões Google são pessoais.', undefined, 7);
    await cue('Em Regras do escritório, o administrador define os limites das integrações.', async () => { await click(page.getByRole('tab', { name: 'Regras do escritório', exact: true })); });
    await click(page.getByRole('tab', { name: 'Conexões', exact: true }));
    await cue('O WhatsApp usa uma conta Business compartilhada. Nesta conta, a conexão ainda precisa ser concluída.', async () => {
      await click(page.getByRole('link', { name: 'WhatsApp', exact: true }));
    }, 7);
  }, true);
  await chapter('12-plano', 'Plano e preferências', '/app/billing', async (page, cue) => {
    await cue('Em Plano, consulte a assinatura e os pagamentos. O checkout abre quando você escolhe pagar.', undefined, 6);
    await cue('No Perfil, atualize seus dados. O rodapé reúne tema, notificações e instalação do aplicativo.', async () => {
      await click(page.getByRole('link', { name: 'Marina Oliveira', exact: true }));
    }, 7);
  });
  await chapter('13-administracao', 'Administração da plataforma', '/app/admin/ai', async (page, cue) => {
    await cue('Administração é exclusiva dos administradores da plataforma. Aqui ficam os modelos e conexões de IA.', undefined, 7);
    await cue('As abas também reúnem clientes, feedback, financeiro e execuções. Configure os modelos por tarefa.', undefined, 6);
    await cue('Anúncios BETA aparece apenas para contas habilitadas. A etapa atual conecta e valida a conta ChatGPT Ads.', undefined, 7);
  }, true);
  await chapter('14-final', 'Continue no seu ritmo', '/app/command-center', async (page, cue) => {
    await cue('Comece por um cliente, organize os documentos no Cofre e acompanhe o trabalho na Agenda.', undefined, 6);
    await cue('Quando precisar, abra Tutorial para rever os passos. Você pode pausar e retomar pelo menu.', async () => {
      await click(page.getByRole('button', { name: 'Tutorial do Lume' }));
    }, 6);
  });
} finally { await browser.close(); }
