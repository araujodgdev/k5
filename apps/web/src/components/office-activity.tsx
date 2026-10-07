import Link from 'next/link';
import { Globe, KeyRound, Megaphone, Scale, Search } from 'lucide-react';
import { CanvasHeader, CanvasPage, CanvasRow } from '@/components/canvas/canvas-page';
import { LumeMark } from './lume-mark';
import { OfficeNavigation } from './office-navigation';
import { listOfficeAudit } from '@/lib/audit';
import { auditActor, auditOutcomeLabels, officeAuditFilters, officeAuditLine, officeAuditSourceLabels } from '@/lib/audit-format';
import { cn } from '@/lib/utils';

const ZONE = 'America/Sao_Paulo';
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('pt-BR', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' });
const shortFormat = new Intl.DateTimeFormat('pt-BR', { timeZone: ZONE, day: '2-digit', month: '2-digit' });
const fullFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: ZONE });
const icons = { judicial: <Scale />, collaboration: <KeyRound />, google: <Globe />, ads: <Megaphone />, knowledge: <Search /> };
const chip = 'inline-flex h-11 shrink-0 items-center rounded-md border px-2.5 text-[13px] whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:h-[30px]';

function href(params: { source?: string; before?: string }) {
  const query = new URLSearchParams({ view: 'activity' });
  if (params.source) query.set('source', params.source);
  if (params.before) query.set('before', params.before);
  return `/app/agenda?${query}`;
}

/** When, as the prototype's activity rows say it: the time today, "ontem", or the date. */
function when(instant: Date, now: Date) {
  const day = dayFormat.format(instant);
  if (day === dayFormat.format(now)) return timeFormat.format(instant);
  return day === dayFormat.format(new Date(now.getTime() - 86_400_000)) ? 'ontem' : shortFormat.format(instant);
}

/** What happened in the office, by the lawyer, their associates and the Lume, newest first. */
export async function OfficeActivity({ officeId, source, before }: { officeId: string; source: string; before: string }) {
  const filter = officeAuditFilters.some(item => item.slug === source) ? source : '';
  const { entries, next } = await listOfficeAudit(officeId, { source: filter, before });
  const now = new Date();
  return <CanvasPage className="gap-5 md:gap-5">
    <CanvasHeader eyebrow="Acessos a casos, consultas aos tribunais, ações no Google, anúncios e buscas do Lume no Cofre" title="Atividade" />
    <OfficeNavigation view="activity" />
    <nav aria-label="Filtrar atividade" className="flex flex-wrap gap-2">
      {officeAuditFilters.map(({ slug, label }) => (
        <Link key={slug} href={href({ source: slug })} aria-current={filter === slug ? 'page' : undefined}
          className={cn(chip, filter === slug ? 'border-transparent bg-selected font-medium text-foreground' : 'border-border text-muted-foreground hover:bg-accent')}>{label}</Link>
      ))}
    </nav>
    {entries.length > 0 && <ol aria-label="Atividade do escritório" className="flex flex-col gap-0.5">
      {entries.map(entry => {
        const at = new Date(entry.createdAt);
        return <li key={`${entry.source}:${entry.id}`}>
          <CanvasRow stacked icon={entry.actorKind === 'agent' ? <LumeMark className="text-foreground" /> : icons[entry.source]}
            title={<span className="whitespace-normal">{auditActor(entry.actorKind, entry.actorName)} {officeAuditLine(entry)}</span>}
            detail={<>{officeAuditSourceLabels[entry.source]} · <span className={cn(entry.outcome === 'error' && 'text-destructive')}>{auditOutcomeLabels[entry.outcome] ?? entry.outcome}</span></>}
            meta={<time dateTime={entry.createdAt} title={fullFormat.format(at)}>{when(at, now)}</time>} />
        </li>;
      })}
    </ol>}
    {entries.length === 0 && <p className="py-3 text-[13.5px] text-muted-foreground">{before ? 'Não há registros mais antigos.' : `Nada registrado${filter ? ' com este filtro' : ''} ainda.`}</p>}
    {next && <Link href={href({ source: filter, before: next })} className="inline-flex h-11 items-center self-start rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:-ml-2 md:h-8">Mais antigos</Link>}
  </CanvasPage>;
}
