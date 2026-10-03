import Link from 'next/link';
import { OfficeNavigation } from './office-navigation';
import { listOfficeAudit } from '@/lib/audit';
import { auditActor, auditOutcomeLabels, officeAuditFilters, officeAuditLine, officeAuditSourceLabels } from '@/lib/audit-format';
import { cn } from '@/lib/utils';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const linkClass = 'underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring';

function href(params: { source?: string; before?: string }) {
  const query = new URLSearchParams({ view: 'activity' });
  if (params.source) query.set('source', params.source);
  if (params.before) query.set('before', params.before);
  return `/app/agenda?${query}`;
}

/** What happened in the office, by the lawyer, their associates and the Lume, newest first. */
export async function OfficeActivity({ officeId, source, before }: { officeId: string; source: string; before: string }) {
  const filter = officeAuditFilters.some(item => item.slug === source) ? source : '';
  const { entries, next } = await listOfficeAudit(officeId, { source: filter, before });
  return <div className="flex min-w-0 flex-1 flex-col px-5 py-6 md:px-10 md:py-10">
    <h1 className="page-title border-b pb-5 max-md:sr-only">Escritório</h1><OfficeNavigation view="activity" />
    <div className="border-b py-5"><p className="max-w-2xl text-sm text-muted-foreground">Quem fez o quê no escritório: acessos a casos, consultas aos tribunais, ações no Google, anúncios e buscas do Lume no Cofre.</p></div>
    <nav aria-label="Filtrar atividade" className="mt-5 flex flex-wrap gap-1">
      {officeAuditFilters.map(({ slug, label }) => (
        <Link key={slug} href={href({ source: slug })} aria-current={filter === slug ? 'page' : undefined}
          className={cn('inline-flex min-h-11 items-center border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9',
            filter === slug ? 'border-foreground text-foreground' : 'border-line text-muted-foreground hover:text-foreground')}>{label}</Link>
      ))}
    </nav>
    <ol aria-label="Atividade do escritório" className="mt-6 border-t">
      {entries.map(entry => (
        <li key={`${entry.source}:${entry.id}`} className="grid gap-1 border-b py-3 text-sm sm:grid-cols-[1fr_auto] sm:gap-x-6">
          <p className="min-w-0">{auditActor(entry.actorKind, entry.actorName)} {officeAuditLine(entry)}</p>
          <time dateTime={entry.createdAt} className="label-mono text-subtle-foreground sm:row-span-2 sm:text-right">{dateFormat.format(new Date(entry.createdAt))}</time>
          <p className="text-[13px] text-muted-foreground">
            {officeAuditSourceLabels[entry.source]} · <span className={cn(entry.outcome === 'error' && 'text-destructive')}>{auditOutcomeLabels[entry.outcome] ?? entry.outcome}</span>
          </p>
        </li>
      ))}
    </ol>
    {entries.length === 0 && <p className="py-12 text-subtle-foreground">{before ? 'Não há registros mais antigos.' : `Nada registrado${filter ? ' com este filtro' : ''} ainda.`}</p>}
    {next && <Link href={href({ source: filter, before: next })} className={cn('mt-6 inline-flex min-h-11 items-center self-start label-mono md:min-h-9', linkClass)}>Mais antigos →</Link>}
  </div>;
}
