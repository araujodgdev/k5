import type { SavedCalculation } from './contracts';

const money = (value: number) => (value / 100).toFixed(2).replace('.', ',');
const safeCell = (text: string) => text.replace(/[\r\n|]/g, ' ').replace(/[<>]/g, '');
export function calculationMarkdown(value: SavedCalculation) {
  const lines = [`# ${safeCell(value.title)}`, `Versão ${value.version} · ${value.createdAt} · método ${value.result.engineVersion}`, `Resultado: R$ ${money(value.result.totalCents)}`, value.notes, '## Premissas', ...value.result.notes,
    '## Memória', ['| Rubrica | Data | Principal | Correção | Juros | Multa | Pagamentos | Saldo / valor |', '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...value.result.rows.map(row => `| ${safeCell(row.label)} | ${row.date} | ${money(row.principalCents)} | ${money(row.correctionCents)} | ${money(row.interestCents)} | ${money(row.penaltyCents)} | ${money(row.paidCents)} | ${money(row.totalCents)} |`)].join('\n'),
    '## Fórmulas por linha', ...value.result.rows.map((row, i) => `${i + 1}. ${safeCell(row.label)}: ${safeCell(row.formula)}`),
    '## Índices utilizados', ...value.result.observations.map(item => `${item.series.toUpperCase()} ${item.month}: ${item.value}%. Consulta: ${item.fetchedAt}. Fonte: ${item.source}`),
    '## Fontes', ...value.result.sources];
  return lines.join('\n\n');
}
export function calculationCsv(value: SavedCalculation) {
  const cell = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
  const lines = [['Cálculo', value.title, 'Versão', String(value.version), 'Método', value.result.engineVersion], ['Rubrica', 'Data', 'Principal', 'Correção', 'Juros', 'Multa', 'Pagamentos', 'Saldo / valor', 'Fórmula'], ...value.result.rows.map(row => [row.label, row.date, ...[row.principalCents, row.correctionCents, row.interestCents, row.penaltyCents, row.paidCents, row.totalCents].map(money), row.formula]), ['Resultado', money(value.result.totalCents)], ...value.result.notes.map(note => ['Premissa', note]), ...value.result.observations.map(item => ['Índice', item.series, item.month, item.value, item.source, item.fetchedAt]), ...value.result.sources.map(source => ['Fonte', source])];
  return '\uFEFF' + lines.map(line => line.map(cell).join(';')).join('\r\n');
}
