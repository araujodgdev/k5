import { z } from 'zod';

export const oabReference = z.object({ id: z.string(), uf: z.enum(['PE', 'RS']), edition: z.literal(2026), code: z.string(), area: z.string(), label: z.string(), fixedCents: z.number().int(), percent: z.string(), rule: z.string(), page: z.number().int(), source: z.string(), verifiedOn: z.literal('2026-10-04') });
export type OabReference = z.infer<typeof oabReference>;
const sources = { PE: 'https://www.oabpe.org.br/files/institutional/17677231591848-tabeladehonorariosadvocatcios2026.pdf', RS: 'https://admsite.oabrs.org.br/arquivos/honorarios-versao-2026.pdf' };
type Entry = [code: string, area: string, label: string, fixedCents: number, percent: string, page: number, rule: string];
const separate = 'Referências publicadas em colunas distintas. Confira a composição no texto integral; não presumir soma.';
const pe: Entry[] = [
  ['1.1', 'Geral', 'Consulta', 50000, '', 1, 'Valor de referência por consulta.'],
  ['1.2', 'Geral', 'Hora intelectual', 50000, '', 1, 'Valor por hora.'],
  ['1.10', 'Geral', 'Notificação extrajudicial', 180000, '', 1, 'Valor de referência pelo serviço.'],
  ['3.1', 'Juizados', 'Inicial ou contestação com audiência', 440000, '20%', 2, 'Conferir nota de quota litis: limite específico de 30% da condenação e vantagem do cliente.'],
  ['4.1', 'Cível', 'Procedimento comum: proposição ou defesa', 600000, '20%', 2, separate],
  ['4.2', 'Cível', 'Cumprimento de sentença', 440000, '20%', 2, separate],
  ['6.4.1.2', 'Família', 'Divórcio consensual com alimentos ou bens', 650000, '10%', 2, 'Acréscimo percentual expressamente previsto; explicitar a base.'],
  ['6.13.1', 'Família', 'Alimentos provisórios ou provisionais', 435000, '3 pensões', 3, 'Três pensões mensais, com mínimo monetário. Não somar automaticamente.'],
  ['6.15.1', 'Família', 'Execução de alimentos', 435000, '3 pensões', 3, 'Três pensões mensais, com mínimo monetário.'],
  ['8.13', 'Trabalhista', 'Reclamação trabalhista ordinária', 660000, '20%', 6, separate],
  ['8.19', 'Trabalhista', 'Contestação trabalhista ordinária', 655000, '20%', 6, separate],
  ['9.1', 'Tributário', 'Defesa fiscal administrativa, primeira instância', 545000, '5% ou 10%', 7, '5% do conteúdo econômico ou 10% do benefício do cliente; bases alternativas.'],
  ['9.6', 'Tributário', 'Repetição de indébito tributário', 650000, '10%', 7, 'Sobre o montante repetido. Conferir notas tributárias.'],
  ['10.6', 'Consumidor', 'Nulidade de cláusulas abusivas', 650000, '20%', 8, separate],
  ['22.8.1', 'Imobiliário', 'Despejo', 505000, '10% a 20%', 12, 'Percentual sobre a anualidade.'],
];
const rs: Entry[] = [
  ['1.1.', 'Geral', 'Consulta', 60000, '', 1, 'Valor de referência por consulta.'],
  ['1.3', 'Geral', 'Hora intelectual', 120000, '', 1, 'Valor por hora.'],
  ['1.13', 'Geral', 'Notificação extrajudicial', 125000, '', 1, 'Valor de referência pelo serviço.'],
  ['2.1', 'Juizados', 'Inicial ou contestação com audiência', 198000, '20%', 2, separate],
  ['7.1', 'Cível', 'Procedimento ordinário: proposição ou defesa', 890000, '20%', 7, separate],
  ['7.3', 'Cível', 'Cumprimento de sentença', 495000, '20%', 7, separate],
  ['13.3.1', 'Família', 'Divórcio extrajudicial sem partilha', 600000, '', 18, 'Consultar o grupo 13.3 da tabela.'],
  ['13.10.1', 'Família', 'Fixação ou revisão de alimentos', 600000, '10% ou 3 pensões', 20, 'Acrescentar três pensões OU 10% da anuidade do proveito econômico.'],
  ['13.10.2', 'Família', 'Execução de alimentos', 1200000, '10%', 20, 'Acrescentar 10% sobre o crédito obtido.'],
  ['27.5', 'Trabalhista', 'Patrocínio do reclamante', 300000, '20% a 30%', 51, 'Sobre condenação ou acordo; conferir composição no texto integral.'],
  ['27.6', 'Trabalhista', 'Defesa da reclamada', 620000, '15% a 30%', 51, 'Sobre condenação ou acordo; conferir composição no texto integral.'],
  ['14.1', 'Tributário', 'Defesa fiscal administrativa, primeira instância', 700000, '10% a 20%', 23, 'Observar percentuais e valores mínimos; conferir notas tributárias.'],
  ['14.9', 'Tributário', 'Repetição de indébito tributário', 1400000, '10% a 20%', 23, 'Sobre montante repetido; observar percentuais e mínimos, sem soma automática.'],
  ['8.3.4', 'Consumidor', 'Nulidade de cláusulas abusivas', 867000, '20%', 9, separate],
  ['15.5.1', 'Imobiliário', 'Despejo', 720000, '10% a 20%', 27, 'A base percentual deve ser conferida no texto integral.'],
];
function catalog(uf: 'PE' | 'RS', entries: Entry[]): OabReference[] {
  return entries.map(([code, area, label, fixedCents, percent, page, rule]) => ({ id: `${uf}-2026-p${page}-${code}`, uf, edition: 2026, code, area, label, fixedCents, percent, page, rule, source: `${sources[uf]}#page=${page}`, verifiedOn: '2026-10-04' }));
}
export const oabCatalog = [...catalog('PE', pe), ...catalog('RS', rs)];
