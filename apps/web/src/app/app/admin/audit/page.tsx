import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformPage } from "@/lib/platform";
import { listPlatformAudit, platformAuditOffice } from "@/lib/audit";
import { auditDetails, platformAuditFilters, platformAuditLabel } from "@/lib/audit-format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Auditoria · Administração" };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" });
const linkClass = "underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

function href(params: { group?: string; office?: string; before?: string }) {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  return `/app/admin/audit${query.size ? `?${query}` : ""}`;
}

/** What administrators and the platform's own processes changed: credits, payments, AI, keys. */
export default async function PlatformAuditPage({ searchParams }: { searchParams: Promise<{ group?: string; office?: string; before?: string }> }) {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const { group = "", office = "", before } = await searchParams;
  const [{ entries, next }, officeName] = await Promise.all([
    listPlatformAudit(context.db, { group, officeId: office || null, before }),
    office ? platformAuditOffice(context.db, office) : null,
  ]);
  return (
    <section>
      <p className="max-w-3xl text-sm text-muted-foreground">Alterações feitas na plataforma, das mais recentes às mais antigas. Os registros não guardam chaves nem conteúdo de clientes.</p>
      <nav aria-label="Filtrar auditoria" className="mt-5 flex flex-wrap gap-1">
        {platformAuditFilters.map(({ slug, label }) => (
          <Link key={slug} href={href({ group: slug, office })} aria-current={group === slug ? "page" : undefined}
            className={cn("inline-flex min-h-11 items-center border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9",
              group === slug ? "border-foreground text-foreground" : "border-line text-muted-foreground hover:text-foreground")}>{label}</Link>
        ))}
      </nav>
      {office && <p className="mt-4 text-sm">Só o escritório {officeName ?? "removido"}. <Link href={href({ group })} className={cn("text-brand-ink", linkClass)}>Ver todos</Link></p>}
      <ol aria-label="Registros de auditoria" className="mt-6 border-t">
        {entries.map(entry => {
          const details = auditDetails(entry.details);
          return (
            <li key={entry.id} className="grid gap-1 border-b py-3 text-sm sm:grid-cols-[1fr_auto] sm:gap-x-6">
              <p className="font-medium">{platformAuditLabel(entry.action)}</p>
              <time dateTime={entry.createdAt} className="label-mono text-subtle-foreground sm:row-span-3 sm:text-right">{dateFormat.format(new Date(entry.createdAt))}</time>
              <p className="min-w-0 text-[13px] text-muted-foreground">
                {entry.actorName ?? "Pessoa removida"}{entry.actorEmail && <span> · {entry.actorEmail}</span>}
                {entry.officeId && <> · <Link href={href({ group, office: entry.officeId })} className={linkClass}>{entry.officeName ?? "Escritório removido"}</Link></>}
              </p>
              {details && <p className="min-w-0 break-words text-[13px] text-subtle-foreground">{details}</p>}
            </li>
          );
        })}
      </ol>
      {entries.length === 0 && <p className="py-12 text-subtle-foreground">{before ? "Não há registros mais antigos." : `Nenhum registro${group || office ? " com este filtro" : ""}.`}</p>}
      {next && <Link href={href({ group, office, before: next })} className={cn("mt-6 inline-flex min-h-11 items-center label-mono md:min-h-9", linkClass)}>Mais antigos →</Link>}
    </section>
  );
}
