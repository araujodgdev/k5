import { AdminCanvas } from '@/components/admin/admin-canvas';
import { officePage } from '@/components/lume/canvas-leaf';
import Link from "next/link";
import { notFound } from "next/navigation";
import { Filter } from "lucide-react";
import { requirePlatformPage } from "@/lib/platform";
import { listPlatformAudit, platformAuditOffice } from "@/lib/audit";
import { auditDetails, platformAuditFilters, platformAuditLabel } from "@/lib/audit-format";
import { DataTable } from "@/components/canvas/canvas-controls";
import { AdminBar, AdminBlock, AdminFooter, AdminGrid, AdminNote, adminFooterLink } from "@/components/admin/admin-blocks";
import { cn } from "@/lib/utils";
import { AdminFilterChip } from "@/components/admin/admin-filters";
import { adminHref } from "@/components/admin/admin-href";
import { AdminMeta } from "@/components/admin/admin-meta";

export const metadata = { title: "Auditoria · Administração" };

const zone = "America/Sao_Paulo";
const whenFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: zone });
const fullFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: zone });
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** What administrators and the platform's own processes changed: credits, payments, AI, keys. */
async function PlatformAuditPage({ searchParams }: PageProps<"/app/admin/audit">) {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const search = await searchParams;
  const group = one(search.group);
  const office = one(search.office);
  const before = one(search.before) || undefined;
  const [{ entries, next }, officeName] = await Promise.all([
    listPlatformAudit(context.db, { group, officeId: office || null, before }),
    office ? platformAuditOffice(context.db, office) : null,
  ]);
  const href = (params: { group?: string; office?: string; before?: string }) => adminHref("/app/admin/audit", params);
  return <>
    <AdminMeta title="Auditoria" />
    <AdminGrid>
      <AdminBlock label="Registros de auditoria">
        <AdminBar label="Filtrar auditoria">
          {platformAuditFilters.map(({ slug, label }) => (
            <AdminFilterChip key={slug} pressed={group === slug} href={href({ group: slug, office })}>{label}</AdminFilterChip>
          ))}
        </AdminBar>
        {office && <AdminNote icon={Filter}>
          Só o escritório {officeName ?? "removido"}. <Link href={href({ group })} className={adminFooterLink}>Ver todos</Link>
        </AdminNote>}
        <DataTable label="Registros de auditoria" tall rows={entries} rowKey={entry => entry.id}
          empty={before ? "Não há registros mais antigos." : `Nenhum registro${group || office ? " com este filtro" : ""}.`} columns={[
            { header: "Ação", width: "minmax(0, 1fr)", strong: true, cell: entry => platformAuditLabel(entry.action), sub: entry => auditDetails(entry.details) },
            { header: "Quem", width: "180px", cell: entry => entry.actorName ?? "Pessoa removida" },
            { header: "Escritório", width: "220px", cell: entry => !entry.officeId
              ? <span className="text-muted-foreground">Plataforma</span>
              : <Link href={href({ group, office: entry.officeId })} className={cn(adminFooterLink, "text-[13.5px]")} title="Ver só este escritório">{entry.officeName ?? "Escritório removido"}</Link> },
            { header: "Quando", width: "96px", align: "end", mono: true, cell: entry =>
              <time dateTime={entry.createdAt} title={fullFormat.format(new Date(entry.createdAt))}>{whenFormat.format(new Date(entry.createdAt)).replace(",", "")}</time> },
          ]} />
        {next && <AdminFooter><Link href={href({ group, office, before: next })} className={adminFooterLink}>Mais antigos →</Link></AdminFooter>}
      </AdminBlock>
    </AdminGrid>
  </>;
}

export default officePage('/app/admin/audit', PlatformAuditPage, AdminCanvas);
