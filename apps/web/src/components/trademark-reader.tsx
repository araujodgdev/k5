'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { requestCapability } from '@/lib/capabilities/http-client';
import { trademarkDetail, type TrademarkDetail } from '@/lib/research/trademarks/contracts';
import { trademarkSituationLabel } from './trademark-workspace';

const labels: Record<string, string> = {
  'Serial number': 'Número do pedido', 'Application number': 'Número do pedido', 'Registration number': 'Número do registro',
  'Application date': 'Data do pedido', 'Registration date': 'Data do registro', 'Publication date': 'Data de publicação',
  'Termination date': 'Data de encerramento', 'Expiry date': 'Data de expiração', 'Expiration date': 'Data de expiração',
  'Nice classification': 'Classificação Nice', 'Goods and services': 'Produtos e serviços',
  'Holder name': 'Titular', 'Holder address': 'Endereço do titular', 'Representative name': 'Representante', 'Representative address': 'Endereço do representante',
  'Status': 'Situação', 'Mark name': 'Nome da marca', 'Mark type': 'Tipo da marca', 'Type': 'Tipo',
  'Kind of mark': 'Natureza da marca', 'Type of mark': 'Apresentação da marca', 'Nice classification - NCL': 'Classificação Nice',
  'Reproduction of the mark': 'Representação da marca', 'Official status': 'Status oficial', 'Status date': 'Data do status',
  'Country of filing': 'País do pedido', 'Application language': 'Idioma do pedido', 'Name': 'Nome', 'Country': 'País', 'Address': 'Endereço',
};
function fieldLabel(label: string) {
  const [section, field] = label.split(' — ');
  if (field && /^7[34]0\b/.test(section)) return `${section.startsWith('730') ? 'Titular' : 'Representante'} — ${labels[field] ?? field}`;
  return labels[label] ?? label;
}
const timestamp = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function TrademarkReader({ resultId }: { resultId: string }) {
  const [detail, setDetail] = useState<TrademarkDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (signal?: AbortSignal, retry = false) => {
    const response = await requestCapability('k5_research_get_trademark', { resultId, retry }, signal);
    if (signal?.aborted) return;
    if (!response.ok) { setError(response.error); return; }
    const raw = response.data && typeof response.data === 'object' && 'trademark' in response.data ? response.data.trademark : null;
    setDetail(trademarkDetail.parse(raw)); setError('');
  }, [resultId]);
  useEffect(() => { const controller = new AbortController(); void Promise.resolve().then(() => load(controller.signal)); return () => controller.abort(); }, [load]);
  const pending = detail?.detailState === 'pending';
  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    const timer = setInterval(() => void load(controller.signal), 3000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [pending, load]);
  return <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-10 md:py-10">
    <Link href={detail ? `/app/research?mode=trademarks&search=${detail.searchId}` : '/app/research?mode=trademarks'} className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Voltar à pesquisa</Link>
    {error && <p role="alert" className="py-4 text-sm text-destructive">{error} <button className="min-h-11 underline" onClick={() => void load()}>Tentar novamente</button></p>}
    {!detail ? !error && <p role="status" className="py-8 text-sm text-muted-foreground">Carregando marca…</p> : <>
      <header className="flex items-start gap-5 border-b py-6">
        {detail.representationUrl && <Image src={detail.representationUrl} alt={`Representação da marca ${detail.name}`} width={100} height={100} unoptimized className="size-20 object-contain sm:size-25" />}
        <div className="min-w-0"><h1 className="page-title break-words">{detail.name || 'Marca sem nome informado'}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{trademarkSituationLabel(detail.situation)}{detail.office ? ` · ${detail.office}` : ''}</p>
          {detail.owner && <p className="mt-2 break-words text-sm">{detail.owner}</p>}
          {detail.applicationNumber && <p className="mt-2 text-sm text-muted-foreground">Pedido {detail.applicationNumber}</p>}
        </div>
      </header>
      <div className="flex flex-wrap gap-x-6 gap-y-3 border-b py-4 text-sm">
        <a href={detail.source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">Ver na WIPO<ArrowUpRight className="size-4" /><span className="sr-only">, abre em nova aba</span></a>
        {detail.source.originUrl && <a href={detail.source.originUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">Escritório de origem<ArrowUpRight className="size-4" /><span className="sr-only">, abre em nova aba</span></a>}
        <span className="text-muted-foreground">Coletado em {timestamp.format(new Date(detail.source.capturedAt))}</span>
      </div>
      {pending && <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />Obtendo detalhes na WIPO… Você pode sair e voltar a esta página.</p>}
      {detail.detailError && <div role="alert" className="flex flex-wrap items-center gap-3 py-5"><p className="text-sm text-destructive">{detail.detailError}</p><Button variant="outline" className="min-h-11 md:min-h-9" disabled={busy} onClick={async () => { setBusy(true); try { await load(undefined, true); } finally { setBusy(false); } }}>Tentar novamente</Button></div>}
      {!!detail.fields.length && <dl>{detail.fields.map((field, index) => <div key={`${field.label}-${index}`} className="grid gap-2 border-b py-4 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] sm:gap-8"><dt className="text-sm text-muted-foreground">{fieldLabel(field.label)}</dt><dd className="whitespace-pre-wrap break-words text-sm leading-6">{field.value}</dd></div>)}</dl>}
      <p className="py-6 text-[13px] leading-5 text-subtle-foreground">Os dados refletem a coleta na WIPO. O status oficial pode ser diferente da categoria geral da base; confirme os campos e o registro no escritório de origem.</p>
    </>}
  </div>;
}
