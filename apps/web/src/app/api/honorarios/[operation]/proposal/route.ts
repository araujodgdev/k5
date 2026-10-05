import { z } from 'zod';
import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { getFeeQuote } from '@/lib/honorarios/quotes';
import { renderLegalPdf } from '@/lib/calc/pdf';
import { DocumentPdfError } from '@/lib/document-pdf-contract';

export async function GET(request: Request, { params }: { params: Promise<{ operation: string }> }) {
  try {
    const context = workspaceContext(await apiWorkspace(request));
    const { operation: id } = await params;
    const url = new URL(request.url);
    const version = z.coerce.number().int().positive().parse(url.searchParams.get('version'));
    const quote = await getFeeQuote(context, { id, version });
    const format = z.enum(['pdf', 'json']).parse(url.searchParams.get('format'));
    const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename="proposta-v${quote.version}.${format}"` };
    if (format === 'json') return new Response(JSON.stringify(quote, null, 2), { headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
    const p = quote.pricing; const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100);
    const text = [`# ${quote.title}`, `Proposta ${quote.id} · versão ${quote.version} · ${p.terms.uf} · ${p.terms.serviceOn}`, '## Escopo', p.terms.scope, '## Condições de pagamento', p.terms.paymentTerms, '## Composição', ...p.components.map((item, index) => `${item.label}: ${item.formula}. ${money(item.totalCents)}. ${item.due === 'success' ? 'Condicionado ao êxito' : 'Conforme contratação'}. ${p.terms.components[index].condition}`), `Contratação: ${money(p.contractedCents)}. Êxito estimado: ${money(p.contingentCents)}.`, '## Referência e observações', p.reference ? `OAB-${p.reference.uf}, edição2026, item ${p.reference.code}. ${p.reference.source}` : 'Atividade sem referência selecionada.', ...p.warnings, p.terms.justification, 'Esta proposta não comprova aceite ou assinatura. A contratação deve ser formalizada pelas partes.'].join('\n\n');
    const bytes = await renderLegalPdf(quote.title, text);
    await getFeeQuote(context, { id, version });
    return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': 'application/pdf' } });
  } catch (error) { return apiError(error instanceof DocumentPdfError ? new ApiError(error.status, error.message) : error); }
}
