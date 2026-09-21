// Synthetic, reproducible fixtures. RAG/document families use different splits;
// Agenda repeats templates across splits and is only an integration diagnostic.
// These labels are engineering expectations, not a human-reviewed legal benchmark.
const topics = [
  ['pagamento', 'O pagamento de R$ 500 foi realizado em 20/09/2026.', 'O pagamento foi realizado.', 'O pagamento não foi realizado.'],
  ['entrega', 'A entrega do equipamento ocorreu em 18/08/2026.', 'O equipamento foi entregue em agosto de 2026.', 'O equipamento foi entregue em julho de 2026.'],
  ['assinatura', 'Ana assinou o contrato em 12/07/2026.', 'Ana assinou o contrato em julho de 2026.', 'Bruno assinou o contrato em julho de 2026.'],
  ['reunião', 'A reunião entre as partes foi cancelada.', 'A reunião foi cancelada.', 'A reunião foi realizada.'],
  ['aviso', 'O aviso de recebimento foi assinado por Marta.', 'Marta assinou o aviso de recebimento.', 'Paulo assinou o aviso de recebimento.'],
  ['saldo', 'O saldo devedor apurado é de R$ 800.', 'O saldo devedor é de R$ 800.', 'O saldo devedor é de R$ 8.000.'],
  ['vistoria', 'A vistoria registrou infiltração no teto.', 'Havia infiltração no teto na vistoria.', 'A vistoria não encontrou infiltração.'],
  ['protocolo', 'O protocolo foi emitido em 02/06/2026.', 'O protocolo foi emitido em junho de 2026.', 'O protocolo foi emitido em junho de 2025.'],
  ['chaves', 'A locadora recebeu as chaves em 01/05/2026.', 'As chaves foram recebidas pela locadora.', 'A locadora ainda não recebeu as chaves.'],
  ['parcelas', 'Foram quitadas duas das cinco parcelas.', 'Duas parcelas foram quitadas.', 'Todas as cinco parcelas foram quitadas.'],
  ['comunicação', 'A comunicação foi enviada por e-mail, sem confirmação de leitura.', 'Foi enviado um e-mail.', 'A comunicação foi enviada por carta registrada.'],
  ['orçamento', 'O orçamento foi apresentado, mas ainda não foi aceito.', 'O orçamento ainda não foi aceito.', 'O orçamento já foi aceito.'],
] as const;
export const ragCorpus = topics.flatMap(([topic, evidence], family) => Array.from({ length: 5 }, (_, n) => ({
  id: `rag-${family}-${n}`, split: family < 8 ? 'development' : 'holdout', query: `O que está documentado sobre ${topic} no caso ${family + 1}?`,
  texts: [
    { text: `Caso ${family + 1}: ${evidence}`, relevance: 3 },
    { text: `Nota do caso ${family + 1} sobre ${topic}: o registro precisa ser conferido no documento original.`, relevance: 1 },
    ...Array.from({ length: 10 }, (_, j) => ({ text: `Arquivo geral ${n}-${j}: ${topic} é uma palavra usada na organização de pastas. Sem informações do caso ${family + 1}.`, relevance: 0 })),
  ],
})));
export const documentCorpus = topics.flatMap(([topic, evidence, supported, contradicted], family) => Array.from({ length: 10 }, (_, n) => ({
  id: `document-${family}-${n}`, split: family < 8 ? 'development' : 'holdout',
  evidence, text: n % 3 === 0 ? supported : n % 3 === 1 ? contradicted : `A pessoa responsável por ${topic} estava no exterior.`,
  expected: n % 3 === 0 ? 'supported' : n % 3 === 1 ? 'contradicted' : 'unsupported',
})));
const agendaTemplates = [
  ['Criar uma tarefa para revisar o contrato', 'create_task'],
  ['Marque uma reunião amanhã das 9h às 10h', 'create_meeting'],
  ['Quero reagendar a reunião de revisão', 'reschedule'],
  ['Conclua a tarefa de revisar o contrato', 'complete'],
  ['Cancele a reunião de revisão', 'cancel'],
  ['Quais reuniões tenho amanhã?', 'query'],
  ['Não crie uma reunião. Era só um exemplo.', 'other'],
  ['Crie uma tarefa e cancele a reunião ao mesmo tempo', 'other'],
] as const;
export const agendaCorpus = agendaTemplates.flatMap(([message, expected], family) => Array.from({ length: 10 }, (_, n) => ({
  id: `agenda-${family}-${n}`, split: n < 6 ? 'development' : 'holdout', message: `${message}. ${n % 2 ? 'Por favor.' : 'Obrigado.'}`, expected,
})));
