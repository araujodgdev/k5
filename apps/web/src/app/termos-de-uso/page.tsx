import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, legalAddress, legalCompany, legalContact, type LegalSection } from "@/components/legal-document";

export const metadata: Metadata = {
  title: "Termos e condições de uso",
  description: "Condições de contratação e uso do Lume, responsabilidades, inteligência artificial, documentos e integrações.",
  alternates: { canonical: "https://lume.software/termos-de-uso" },
  robots: { index: true, follow: true },
};

const sections: LegalSection[] = [
  { id: "empresa", title: "Prestadora e alcance", paragraphs: [
    <>O Lume é disponibilizado por {legalCompany}, pessoa jurídica de direito privado, inscrita no CNPJ sob nº 57.717.768/0001-06, com endereço em {legalAddress}, doravante Web Star Studio. O canal para assuntos contratuais, suporte e privacidade é {legalContact}.</>,
    "Estes termos disciplinam o uso do site lume.software e dos recursos do Lume, inclusive serviços de integração e notificação em seus subdomínios. Escritório é o ambiente de trabalho de uma organização ou profissional. Contratante é quem contrata o serviço e possui poderes para representar esse ambiente. Usuário é cada pessoa autorizada a acessá-lo. Conteúdo do escritório compreende arquivos, casos, mensagens, instruções e demais dados inseridos ou importados por seus usuários.",
    <>A contratação está sujeita a estes termos e às condições da oferta efetivamente aceita. A <Link href="/politica-privacidade">Política de privacidade</Link> explica o tratamento de dados pessoais; sua leitura não constitui consentimento genérico para qualquer tratamento. Condições específicas negociadas por escrito prevalecem no respectivo objeto, sem afastar normas obrigatórias ou direitos de terceiros.</>,
  ] },
  { id: "servico", title: "Objeto e limites do serviço", paragraphs: [
    "O Lume oferece software de apoio ao trabalho jurídico, com organização de documentos e casos, pesquisa, assistência por inteligência artificial, colaboração, tarefas, agenda e registros de honorários, conforme os recursos e limites disponíveis no plano e no ambiente contratado. Integrações dependem de configuração, permissões, contratação e disponibilidade dos respectivos fornecedores.",
    "A Web Star Studio presta um serviço tecnológico. O uso do Lume não constitui contratação de advocacia, mandato, representação processual, custódia de valores ou aconselhamento profissional pela prestadora. O módulo de honorários registra informações do escritório e não movimenta, por si, dinheiro de clientes.",
    "Recursos experimentais ou identificados como beta podem mudar ou ser interrompidos. Demonstrações e descrições de recursos futuros não substituem a oferta contratada. Nenhuma funcionalidade indisponível deve ser tomada como obrigação já assumida, ressalvadas ofertas vinculantes na forma da lei.",
  ] },
  { id: "conta", title: "Cadastro, representação e acesso", paragraphs: [
    "O serviço se destina a pessoas com pelo menos 18 anos e capacidade para contratar. Quem cria ou administra um escritório deve possuir autorização para representá-lo e convidar seus integrantes. A atribuição de um papel na plataforma não comprova inscrição profissional ou poderes de representação perante terceiros.",
    "Cada usuário deve fornecer dados corretos, proteger sua senha, utilizar uma conta individual e informar suspeitas de acesso indevido. O administrador deve revisar integrantes, vínculos e permissões quando houver mudança de função ou desligamento. A responsabilidade por um incidente será apurada conforme a participação de cada parte e a legislação aplicável, sem presunção absoluta de culpa do titular da conta.",
    "Acesso a casos, arquivos e funções depende dos papéis e compartilhamentos concedidos. Convites e links de acesso devem ser enviados apenas a destinatários autorizados. A disponibilização voluntária de conteúdo a um colaborador constitui instrução de compartilhamento daquele conteúdo, dentro das permissões atribuídas.",
  ] },
  { id: "ia", title: "Inteligência artificial e revisão profissional", paragraphs: [
    "A IA pode receber instruções, histórico de conversas, arquivos ou trechos selecionados e resultados de ferramentas para produzir respostas, classificações, extrações e minutas. Esses materiais podem conter erros, omissões, referências inexistentes, interpretações inadequadas ou informações desatualizadas. O reconhecimento de texto e a busca também podem deixar de identificar conteúdo relevante.",
    "Antes de utilizar uma saída em um caso, comunicação ou decisão, o usuário deve conferir fatos, cálculos, nomes, datas, citações, fontes originais, vigência das normas e adequação ao contexto. Indicações de fonte, confiança ou validação automática auxiliam essa revisão e não certificam a correção jurídica. O Lume não garante êxito processual, completude da pesquisa, originalidade exclusiva da saída nem ausência de direitos de terceiros.",
    "O profissional mantém o julgamento e a responsabilidade pelos atos que pratica. O Lume não deve ser usado como único mecanismo de controle de prazos, acompanhamento de publicações ou verificação de intimações. Agenda, sugestões de prioridade e alertas não constituem cálculo automático ou certificação de prazo judicial.",
    "O assistente mantém uma memória pessoal entre conversas, processada também pela Honcho, fornecedora de memória para IA, conforme a Política de privacidade. Essa memória serve a preferências e forma de trabalho: o usuário não deve pedir que ela guarde dados de clientes, partes ou processos, e pode pedir ao Lume que a apague a qualquer momento.",
    "Ferramentas podem executar operações conforme permissões e regras vigentes no escritório. Algumas ações exigem confirmação e outras podem ser automatizadas quando configuradas. Antes de autorizar automações, o responsável deve avaliar o alcance, os destinatários e os efeitos possíveis. A confirmação de uma ação não elimina a responsabilidade da Web Star Studio por defeitos que lhe sejam imputáveis.",
  ] },
  { id: "integracoes", title: "Integrações e fontes externas", paragraphs: [
    "Conexões com Google, serviços de mensagens, provedores de IA e fontes judiciais são opcionais ou vinculadas ao recurso solicitado. O usuário deve possuir autorização para conectar a conta e para realizar as operações escolhidas. As condições do terceiro também se aplicam ao uso de seu serviço, sem transferir a ele as obrigações próprias da Web Star Studio.",
    "O envio de mensagens, edição de arquivos, sincronização de eventos ou consulta a sistemas externos pode produzir efeitos fora do Lume. Confira as informações e as regras de confirmação antes da execução. Desconectar uma conta impede novos acessos por essa conexão, mas não desfaz mensagens enviadas, operações concluídas ou cópias já importadas.",
    "Fontes públicas, tribunais e serviços externos podem restringir acesso, alterar formatos, apresentar atrasos ou ficar indisponíveis. A pesquisa e o acompanhamento dependem da cobertura efetivamente disponível. O usuário deve conferir o sistema oficial para atos processuais, publicações, situação de processos e prova de protocolo. Preparar arquivos para um tribunal não equivale a protocolá-los.",
  ] },
  { id: "conteudo", title: "Conteúdo, sigilo e instruções de tratamento", paragraphs: [
    "Os direitos sobre o conteúdo inserido permanecem com seus titulares. O contratante concede somente a autorização necessária para hospedar, reproduzir tecnicamente, processar, indexar, transmitir aos prestadores envolvidos e disponibilizar esse conteúdo para executar o serviço e as instruções autorizadas. Essa autorização não transfere a titularidade do acervo à Web Star Studio nem permite sua exploração comercial independente.",
    "O escritório deve verificar a base legal, a necessidade e os deveres de sigilo antes de inserir dados de clientes, contrapartes, testemunhas ou outras pessoas. Deve considerar as restrições profissionais, contratuais e judiciais aplicáveis, inclusive segredo de justiça. O caráter público de um processo não afasta a proteção dos dados pessoais nele contidos.",
    "Quando atua como operadora de dados do escritório, a Web Star Studio deve tratar o conteúdo conforme instruções lícitas documentadas pela contratação, pelas configurações e pelas ações autorizadas, empregar medidas de segurança compatíveis e cooperar no atendimento de titulares e incidentes. Instruções incompatíveis com a lei podem ser recusadas com explicação ao contratante, ressalvado impedimento legal.",
    "O acesso operacional ao conteúdo deve se limitar ao necessário para prestar suporte autorizado, corrigir falhas, proteger o serviço ou cumprir obrigação legal. Deveres de confidencialidade persistem após o encerramento, enquanto a informação conservar caráter sigiloso. Obrigações próprias do escritório não afastam as obrigações legais da prestadora e de seus fornecedores.",
  ] },
  { id: "uso", title: "Uso permitido e condutas vedadas", paragraphs: [
    "Utilize o Lume para finalidades lícitas, respeitando o sigilo profissional, os direitos de personalidade e de propriedade intelectual. Não insira material que não possa legitimamente tratar ou compartilhar. Não utilize a plataforma para fraude, assédio, discriminação ilícita, vigilância indevida ou envio abusivo de mensagens.",
    "É vedado acessar dados de outro escritório sem autorização, compartilhar credenciais para contornar limites contratados, introduzir código malicioso, explorar falhas para obter dados, interferir no serviço ou contornar controles de segurança e limites técnicos. Pesquisa de segurança deve preservar dados de terceiros e ser comunicada pelo canal de contato, sem exploração destrutiva.",
  ] },
  { id: "contratacao", title: "Planos, cobrança e renovação", paragraphs: [
    "Preço, moeda, periodicidade, limites de uso, eventual período de teste e condições de renovação são os apresentados na oferta e no fluxo de contratação. O cadastro, isoladamente, não autoriza cobranças não informadas. Recursos pagos dependem da contratação correspondente. Consumos adicionais somente podem ser cobrados quando previstos e autorizados.",
    "Quando disponível, o pagamento é processado por fornecedor especializado, como AbacatePay. O Lume recebe informações necessárias à conciliação, como identificador, valor, situação e período da assinatura. Uma tela ou transação de teste não comprova pagamento real. A liberação depende da confirmação válida do pagamento e das condições da oferta.",
    "Renovação automática somente se aplica quando informada e autorizada na contratação. Alterações de preço para períodos futuros serão comunicadas antes da cobrança, permitindo ao contratante decidir sobre a continuidade. A alteração não modifica retroativamente o preço de um período já pago.",
  ] },
  { id: "cancelamento", title: "Cancelamento, reembolso e encerramento", paragraphs: [
    <>O contratante pode solicitar cancelamento pelo controle disponível na assinatura ou por {legalContact}. O pedido será tratado para impedir renovações futuras, observadas cobranças já legitimamente constituídas. O acesso relativo ao período pago segue a oferta contratada, salvo reembolso com encerramento, suspensão justificada ou outra condição mais favorável aplicável.</>,
    "Quando caracterizada relação de consumo e contratação fora do estabelecimento comercial, fica preservado o direito legal de arrependimento de sete dias e a restituição devida. Também ficam preservados os direitos decorrentes de cobrança indevida, vício ou inadimplemento do serviço. Nenhuma disposição estabelece proibição absoluta de reembolso.",
    "Cancelar uma assinatura, excluir uma conta individual e eliminar o acervo do escritório são operações diferentes. Um usuário não pode exigir a remoção de documentos de todo o escritório apenas por deixar de integrá-lo. Antes do encerramento, o administrador deve providenciar as exportações disponíveis ou solicitar orientação para obtenção dos dados que possa legitimamente receber. Restrições por sigilo, direitos de terceiros e guarda legal serão informadas.",
    "A inadimplência pode levar à restrição dos recursos pagos, com informação ao contratante e possibilidade de regularização. Ela não implica perda automática da titularidade dos documentos. A conservação e eliminação de dados seguem a Política de privacidade e as obrigações legais aplicáveis.",
  ] },
  { id: "disponibilidade", title: "Operação, suporte e continuidade", paragraphs: [
    "A Web Star Studio deve prestar o serviço com diligência e adotar medidas proporcionais de segurança e correção de falhas. Podem ocorrer interrupções por manutenção, falhas de infraestrutura, dependências externas ou eventos fora do controle razoável das partes. Não há percentual contratual de disponibilidade, prazo fixo de atendimento ou garantia de recuperação de qualquer versão de arquivo, salvo acordo específico por escrito.",
    "O escritório deve manter cópias dos documentos essenciais e rotinas próprias de continuidade. Isso não exonera a prestadora de seus deveres de proteção e de reparação quando cabíveis. Falhas de fornecedores não excluem automaticamente a responsabilidade prevista em lei.",
    "Solicitações de suporte devem indicar o problema e o contexto necessário, evitando envio de senhas, credenciais, documentos integrais ou dados excessivos por e-mail. A equipe poderá orientar um meio apropriado para análise do caso.",
  ] },
  { id: "propriedade", title: "Software e propriedade intelectual", paragraphs: [
    "O software, a marca Lume, a interface e os elementos de titularidade da Web Star Studio são protegidos pela legislação aplicável. O contratante recebe licença limitada, não exclusiva e vinculada à contratação para usar os recursos disponíveis. Componentes de terceiros permanecem sujeitos às respectivas licenças.",
    "Essa proteção não se estende à apropriação dos documentos do escritório, de dados públicos ou de direitos preexistentes de terceiros. O usuário pode utilizar e exportar as saídas obtidas legitimamente para seu trabalho, respeitando tais direitos. Resultados de IA podem ser semelhantes aos produzidos para outras pessoas, e a existência de proteção autoral depende da legislação e das características do material.",
  ] },
  { id: "responsabilidade", title: "Responsabilidade e reparação", paragraphs: [
    "Cada parte responde pelo descumprimento das obrigações que lhe incumbem, conforme a legislação, a natureza da relação, o dano e o nexo causal. Os limites funcionais descritos nestes termos não constituem exoneração por defeitos do serviço, falhas de segurança imputáveis à prestadora, dolo ou culpa quando a responsabilidade for legalmente exigível.",
    "Não se promete resultado jurídico, econômico ou profissional específico decorrente do uso da plataforma. A responsabilidade por conteúdo inserido ilicitamente, compartilhamento indevido ou ato praticado pelo usuário será avaliada segundo as circunstâncias, sem afastar a participação de outros responsáveis.",
    "Nenhuma cláusula limita direitos inderrogáveis do consumidor ou do titular de dados, estabelece renúncia genérica à indenização, transfere integralmente o risco ao usuário ou inverte em seu desfavor o ônus da prova previsto em lei.",
  ] },
  { id: "suspensao", title: "Suspensão e término por descumprimento", paragraphs: [
    "O acesso pode ser restringido para cumprir ordem legal, conter risco concreto de segurança, impedir fraude ou interromper violação destes termos. A medida deve ser proporcional, limitada ao necessário e acompanhada de informação sobre o motivo e o canal de contestação, salvo proibição legal ou risco à investigação e à segurança.",
    "Quando a situação permitir, será oferecida oportunidade de correção antes do encerramento. Riscos urgentes podem exigir suspensão imediata. A providência não autoriza retenção abusiva de dados nem elimina direitos de defesa, restituição ou reparação. Obrigações de confidencialidade, guarda legal e pagamento legitimamente constituídas podem sobreviver ao término.",
  ] },
  { id: "alteracoes", title: "Alterações e comunicações", paragraphs: [
    "A versão vigente é identificada pela data no início deste documento. Mudanças materiais nas condições contratadas serão comunicadas por meio adequado, com antecedência compatível com seu impacto e oportunidade de cancelamento, ressalvadas medidas urgentes exigidas por lei ou segurança. Não haverá aplicação retroativa para retirar direitos já constituídos.",
    "Quando necessário, uma nova manifestação de concordância será solicitada. A simples atualização da Política de privacidade não substitui consentimento específico exigido por lei. O contratante pode solicitar cópia da versão aplicável à sua contratação pelo canal de contato.",
  ] },
  { id: "lei", title: "Lei aplicável e solução de controvérsias", paragraphs: [
    "Aplicam-se as leis brasileiras, inclusive o Código Civil, o Marco Civil da Internet, a LGPD e o Código de Defesa do Consumidor quando incidente. As partes podem buscar solução pelo canal de contato, sem que isso seja requisito para acesso ao Judiciário, a órgãos de defesa do consumidor ou à autoridade de proteção de dados.",
    "Para relações empresariais em que a eleição seja válida, fica eleito o foro de Porto Alegre/RS, relacionado ao domicílio da prestadora. Permanecem preservados o foro do domicílio do consumidor quando aplicável e as demais regras de competência obrigatória. Não há arbitragem compulsória nestes termos.",
    "A invalidade de uma disposição não afeta as demais que possam subsistir. A tolerância pontual não representa renúncia permanente. Transferências contratuais ou reorganizações societárias devem preservar os direitos do contratante e as obrigações de proteção de dados.",
  ] },
];

export default function TermsPage() {
  return <LegalDocument title="Termos e condições de uso" introduction="As condições para usar o Lume e contratar seus recursos, com os deveres da plataforma, do escritório e de cada usuário." sections={sections} />;
}
