'use client';
import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, LoaderCircle, Search } from 'lucide-react';
import { CanvasTrail, trailAction } from '@/components/canvas/canvas-controls';
import { CanvasHeader, CanvasPage, CanvasSection } from '@/components/canvas/canvas-page';
import { CanvasMeta } from '@/components/shell/shell-context';
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
  const back = detail ? `/app/research?mode=trademarks&search=${detail.searchId}` : '/app/research';
  const link = 'relative inline-flex min-h-11 items-center gap-1 rounded-sm text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:min-h-6';
  return <>
    <CanvasMeta title="Pesquisa" subject={{ kind: 'module', slug: 'research', title: 'Pesquisa' }} />
    <CanvasTrail back={{ href: back, label: 'Pesquisa' }} icon={<Search />} current={detail ? detail.name || 'Marca sem nome informado' : 'Marca'} actions={detail && <>
      <Button asChild variant="ghost" className={trailAction}><a href={detail.source.url} target="_blank" rel="noopener noreferrer"><ArrowUpRight aria-hidden="true" /><span className="max-md:sr-only">Ver na WIPO</span><span className="sr-only">, abre em nova aba</span></a></Button>
    </>} />
    <CanvasPage className="md:gap-8">
      {error && <p role="alert" className="text-[13.5px] text-destructive">{error} <button type="button" className="min-h-11 underline underline-offset-2" onClick={() => void load()}>Tentar novamente</button></p>}
      {!detail ? !error && <p role="status" className="text-[13.5px] text-muted-foreground">Carregando marca…</p> : <>
        <div className="flex items-start gap-5">
          {detail.representationUrl && <Image src={detail.representationUrl} alt={`Representação da marca ${detail.name}`} width={88} height={88} unoptimized className="size-16 shrink-0 rounded-lg border border-border bg-card object-contain p-1.5 md:size-[88px]" />}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <CanvasHeader eyebrow={[trademarkSituationLabel(detail.situation), detail.office].filter(Boolean).join(' · ')} title={<span className="break-words">{detail.name || 'Marca sem nome informado'}</span>} />
            {detail.owner && <p className="break-words text-[14.5px]">{detail.owner}</p>}
            {detail.applicationNumber && <p className="font-mono text-[12.5px] text-muted-foreground">Pedido {detail.applicationNumber}</p>}
            <div className="flex flex-wrap items-center gap-x-5">
              {detail.source.originUrl && <a href={detail.source.originUrl} target="_blank" rel="noopener noreferrer" className={link}>Escritório de origem<ArrowUpRight className="size-3.5" aria-hidden="true" /><span className="sr-only">, abre em nova aba</span></a>}
              <span className="text-[13px] text-muted-foreground">Coletado em {timestamp.format(new Date(detail.source.capturedAt))}</span>
            </div>
          </div>
        </div>
        {pending && <p role="status" className="flex items-center gap-2 text-[13.5px] text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Obtendo detalhes na WIPO… Você pode sair e voltar a esta página.</p>}
        {detail.detailError && <div role="alert" className="flex flex-wrap items-center gap-3"><p className="text-[13.5px] text-destructive">{detail.detailError}</p>
          <Button variant="outline" size="lg" className="h-11 md:h-[34px]" disabled={busy} onClick={async () => { setBusy(true); try { await load(undefined, true); } finally { setBusy(false); } }}>Tentar novamente</Button></div>}
        {!!detail.fields.length && <CanvasSection title="Registro">
          <dl className="flex flex-col">{detail.fields.map((field, index) => <div key={`${field.label}-${index}`} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)] sm:gap-6">
            <dt className="text-[13px] text-muted-foreground">{fieldLabel(field.label)}</dt><dd className="whitespace-pre-wrap break-words text-[13.5px] leading-6">{field.value}</dd></div>)}</dl>
        </CanvasSection>}
        <p className="text-xs leading-5 text-subtle-foreground">Os dados refletem a coleta na WIPO. O status oficial pode ser diferente da categoria geral da base; confirme os campos e o registro no escritório de origem.</p>
      </>}
    </CanvasPage>
  </>;
}
