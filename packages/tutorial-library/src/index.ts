export type TutorialVideo = { id: string; title: string; description: string; chapters: string[]; notice?: string };
export type TutorialModule = { id: string; title: string; audience: 'everyone' | 'platform-admin'; videos: TutorialVideo[] };

export const tutorialModules: TutorialModule[] = [
  { id: 'inicio', title: 'Primeiros passos', audience: 'everyone', videos: [
    { id: 'inicio-e-navegacao', title: 'Início e navegação', description: 'Encontre os módulos e conheça o passeio pelas telas.', chapters: ['01-inicio'] },
    { id: 'retomar-o-tutorial', title: 'Retomar o tutorial', description: 'Volte ao passeio e continue no seu ritmo.', chapters: ['14-final'] },
  ] },
  { id: 'escritorio', title: 'Escritório', audience: 'everyone', videos: [
    { id: 'clientes', title: 'Cadastrar e consultar clientes', description: 'Cadastre um contato, edite a ficha e consulte seus vínculos.', chapters: ['02-clientes'] },
    { id: 'tarefas-e-agenda', title: 'Organizar tarefas e agenda', description: 'Crie atividades e alterne entre lista, Kanban e calendário.', chapters: ['04-tarefas'] },
    { id: 'equipe-e-convites', title: 'Equipe e convites', description: 'Gravação anterior sobre equipe e convites.', chapters: ['10-equipe'], notice: 'Esta gravação mostra o modelo anterior de equipe. Na versão atual, a colaboração fica em Escritório, na aba Associados, e em Participantes de cada caso no Cofre.' },
  ] },
  { id: 'cofre', title: 'Cofre', audience: 'everyone', videos: [
    { id: 'casos-e-documentos', title: 'Organizar casos e documentos', description: 'Crie um caso, envie arquivos e encontre os participantes.', chapters: ['03-cofre'] },
  ] },
  { id: 'honorarios', title: 'Honorários', audience: 'everyone', videos: [
    { id: 'parcelas-e-recebimentos', title: 'Registrar parcelas e recebimentos', description: 'Cadastre honorários e acompanhe os valores recebidos.', chapters: ['05-honorarios'] },
  ] },
  { id: 'lume', title: 'Lume', audience: 'everyone', videos: [
    { id: 'assistente', title: 'Conversar com o assistente', description: 'Inicie uma conversa e acompanhe a preparação de um documento.', chapters: ['06-lume'] },
  ] },
  { id: 'documentos', title: 'Documentos', audience: 'everyone', videos: [
    { id: 'revisao-e-exportacao', title: 'Revisar e exportar documentos', description: 'Confira o texto no editor e exporte em DOCX.', chapters: ['06b-documento'] },
  ] },
  { id: 'pesquisa', title: 'Pesquisa', audience: 'everyone', videos: [
    { id: 'busca-e-historico', title: 'Pesquisar e consultar o histórico', description: 'Faça uma busca e encontre pesquisas anteriores.', chapters: ['07-pesquisa'] },
  ] },
  { id: 'emails', title: 'E-mails', audience: 'everyone', videos: [
    { id: 'gmail', title: 'Usar o Gmail conectado', description: 'Consulte a caixa e prepare uma mensagem para revisão.', chapters: ['08-email'] },
  ] },
  { id: 'mensagens', title: 'Mensagens', audience: 'everyone', videos: [
    { id: 'conversas-e-compartilhamentos', title: 'Conversar e compartilhar arquivos', description: 'Abra uma conversa e compartilhe documentos do Cofre.', chapters: ['09-mensagens'] },
  ] },
  { id: 'integracoes', title: 'Integrações', audience: 'everyone', videos: [
    { id: 'google-e-whatsapp', title: 'Conectar Google e WhatsApp', description: 'Conheça as conexões e as regras do escritório.', chapters: ['11-integracoes'] },
  ] },
  { id: 'plano', title: 'Plano e perfil', audience: 'everyone', videos: [
    { id: 'plano-e-preferencias', title: 'Consultar o plano e as preferências', description: 'Encontre a assinatura e os ajustes da sua conta.', chapters: ['12-plano'] },
  ] },
  { id: 'administracao', title: 'Administração', audience: 'platform-admin', videos: [
    { id: 'administracao-da-plataforma', title: 'Administrar a plataforma', description: 'Consulte configurações de IA e informações da plataforma.', chapters: ['13-administracao'] },
  ] },
];

export function tutorialMedia(id: string) {
  const base = `/tutorial/videos/${id}`;
  return { video: `${base}/video.mp4`, captions: `${base}/legendas.pt-BR.vtt`, poster: `${base}/capa.jpg` };
}

export function tutorialDuration(seconds: number) {
  const rounded = Math.ceil(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
