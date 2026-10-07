import type { NavSlug } from '@/lib/navigation';

export type TutorialAccess = { whatsappEnabled: boolean; adsEnabled: boolean; platformAdmin: boolean; canvasShell: boolean };
export type TutorialStep = { id: string; title: string; description: string; href: string; target: string; module?: NavSlug | 'admin' };

const steps: TutorialStep[] = [
  { id: 'home', title: 'Seu dia começa aqui', description: 'O Início mostra o que precisa de você hoje: tarefas, reuniões, parcelas e publicações. Logo abaixo ficam os casos recentes e o que o Lume fez.', href: '/app/command-center', target: '#main-content h1' },
  { id: 'navigation', title: 'Cada área tem seu lugar', description: 'Use o menu para mudar de módulo. No celular, Início, Lume, Cofre e Escritório ficam na barra inferior. As outras áreas ficam em Mais.', href: '/app/command-center', target: '[data-tutorial="navigation"]' },
  { id: 'clients', title: 'Comece pelo cliente', description: 'Cadastre o contato em Novo cliente. Ao abrir sua ficha, você encontra os casos e as atividades vinculadas. Revisores podem consultar os dados compartilhados.', href: '/app/agenda?view=clients', target: '[aria-label="Visões do escritório"]', module: 'agenda' },
  { id: 'vault', title: 'Organize casos e documentos', description: 'Crie um caso no Cofre e envie seus arquivos. A Biblioteca guarda materiais gerais. Dentro do caso, organize pastas e acompanhe o processamento antes de consultar o conteúdo com Lume.', href: '/app/vault', target: '#main-content header', module: 'vault' },
  { id: 'tasks', title: 'Acompanhe o trabalho', description: 'Em Nova atividade, defina a tarefa, o prazo e o responsável. Alterne entre Lista e Kanban. Tarefas concluídas ficam em Arquivadas; você pode reabri-las.', href: '/app/agenda?view=tasks', target: '[aria-label="Visualização das tarefas"]', module: 'agenda' },
  { id: 'calendar', title: 'Planeje os compromissos', description: 'Escolha um dia para ver sua agenda. Reuniões têm início e fim. A agenda do escritório é separada do Google pessoal, que depende de conexão em Integrações.', href: '/app/agenda?view=calendar', target: '[aria-label="Origem da agenda"]', module: 'agenda' },
  { id: 'agent', title: 'Peça ajuda ao Lume', description: 'Escreva seu pedido ou anexe documentos. Peça consultas ao Cofre, organize tarefas ou redija uma minuta. Confira as fontes e revise o resultado. Ações que exigem confirmação aparecem na conversa.', href: '/app/agents', target: '[aria-label="Pergunte ao Lume"]', module: 'agents' },
  { id: 'research', title: 'Pesquise e confira as fontes', description: 'Em Nova pesquisa, escolha Jurisprudência ou Marca e preencha os critérios. Abra os resultados para conferir o conteúdo antes de citar. Suas pesquisas ficam listadas aqui para você retomar.', href: '/app/research', target: '#main-content h1', module: 'research' },
  { id: 'fees', title: 'Controle os honorários', description: 'Registre o valor por cliente, organize as parcelas e lance os recebimentos. O saldo acompanha as baixas manuais. Este módulo não emite cobranças bancárias.', href: '/app/honorarios', target: '#main-content h1', module: 'honorarios' },
  { id: 'messages', title: 'Converse e compartilhe', description: 'Mensagens reúne conversas com pessoas e compartilhamentos do Cofre. Confira o destinatário e as permissões antes de enviar. Respostas por e-mail não são importadas para a conversa.', href: '/app/messages', target: '#main-content h1', module: 'messages' },
  { id: 'email', title: 'Acesse seus e-mails', description: 'Após conectar o Google, consulte sua caixa e abra as conversas. As opções inteligentes ajudam a resumir mensagens e preparar respostas. Revise o texto antes do envio.', href: '/app/email', target: '#main-content h1', module: 'email' },
  { id: 'whatsapp', title: 'Atenda pelo WhatsApp', description: 'O piloto usa uma conta WhatsApp Business conectada. A caixa é compartilhada pelo escritório; confira a conversa e o destinatário antes de enviar.', href: '/app/whatsapp', target: '#main-content h1', module: 'whatsapp' },
  { id: 'ads', title: 'Conecte a conta de anúncios', description: 'Anúncios está em BETA. A etapa disponível conecta e valida a conta ChatGPT Ads. A criação e a gestão de campanhas ainda não estão disponíveis.', href: '/app/ads', target: '#main-content h1', module: 'ads' },
  { id: 'integrations', title: 'Conecte os serviços que usa', description: 'Integrações reúne as conexões pessoais, como Google. Cada serviço informa sua disponibilidade e as permissões solicitadas. Você também encontra as regras do escritório.', href: '/app/integrations', target: '#main-content h1', module: 'integrations' },
  { id: 'associates', title: 'Trabalhe com outros advogados', description: 'Em Associados, convide advogados da plataforma para trabalhar com você. Depois, escolha quais associados participam de cada caso em Participantes, dentro do Cofre.', href: '/app/agenda?view=associates', target: '[aria-label="Visões do escritório"]', module: 'agenda' },
  { id: 'plan', title: 'Consulte o plano do escritório', description: 'A área Plano mostra a situação da assinatura. Quando os pagamentos estão habilitados, você pode acessar o checkout e consultar os pagamentos.', href: '/app/billing', target: '#main-content h1', module: 'billing' },
  { id: 'admin', title: 'Administre a plataforma', description: 'Esta área é exclusiva da administração da plataforma. Ela reúne clientes, feedback, configurações de IA e execuções. O seu escritório continua separado desse acesso.', href: '/app/admin', target: '#main-content h1', module: 'admin' },
  { id: 'finish', title: 'Continue no seu ritmo', description: 'Abra Tutorial no menu sempre que quiser rever estes passos. Seu progresso fica salvo neste navegador, separado por pessoa e escritório. Você também pode ajustar seu perfil, tema e notificações.', href: '/app/command-center', target: '[data-tutorial="trigger"]' },
];

/**
 * The canvas shell has no sidebar or tab bar, and the Lume lives in a panel beside every view
 * (/app/agents redirects to Início there), so these steps point somewhere else.
 */
const canvasSteps: Partial<Record<TutorialStep['id'], Partial<TutorialStep>>> = {
  navigation: { description: 'Abra um módulo pelo botão Casos e módulos, no alto do canvas. Cada módulo abre numa aba. No celular, o botão fica em Mais opções.' },
  agent: {
    href: '/app/command-center', target: '#lume-panel',
    description: 'O Lume fica no painel ao lado de todas as telas. Escreva seu pedido ou anexe documentos, peça consultas ao Cofre, organize tarefas ou redija uma minuta. Ações que exigem confirmação aparecem na conversa.',
  },
  finish: { description: 'Abra o Tutorial pelo botão Casos e módulos (no celular, em Mais opções) sempre que quiser rever estes passos. Seu progresso fica salvo neste navegador, separado por pessoa e escritório. Você também pode ajustar seu perfil, tema e notificações.' },
};

export function tutorialSteps(access: TutorialAccess) {
  return steps.filter(step => (step.module !== 'whatsapp' || access.whatsappEnabled)
    && (step.module !== 'ads' || access.adsEnabled) && (step.module !== 'admin' || access.platformAdmin))
    .map(step => access.canvasShell ? { ...step, ...canvasSteps[step.id] } : step);
}

export function tutorialStorageKey(userId: string, officeId: string) {
  return `lume:tutorial:v1:${userId}:${officeId}`;
}
