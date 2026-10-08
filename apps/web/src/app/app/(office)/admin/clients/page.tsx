import { AdminCanvas } from '@/components/admin/admin-canvas';
import { officePage } from '@/components/lume/canvas-leaf';
import Link from "next/link";
import { notFound } from "next/navigation";
import { listOfficesForPlatform } from "@/lib/ai-connections-core";
import { requirePlatformPage } from "@/lib/platform";
import { DataTable } from "@/components/canvas/canvas-controls";
import { AdminBlock, AdminGrid, adminLink } from "@/components/admin/admin-blocks";
import { AdminMeta } from "@/components/admin/admin-meta";

export const metadata = { title: "Clientes · Administração" };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

/** The offices on the platform. Their AI is configured once, in the IA section. */
async function PlatformClientsPage() {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const offices = await listOfficesForPlatform(context.db);
  return <>
    <AdminMeta title="Clientes" />
    <AdminGrid>
      <AdminBlock label="Escritórios">
        <DataTable label="Escritórios clientes" rows={offices} rowKey={office => office.id} empty="Nenhum escritório cadastrado." columns={[
          { header: "Escritório", width: "minmax(0, 1fr)", cell: office => <Link href={`/app/admin/clients/${office.id}`} className={adminLink}>{office.name}</Link> },
          { header: "Pessoas", width: "90px", align: "end", mono: true, cell: office => Number(office.memberCount) },
          { header: "Desde", width: "110px", align: "end", mono: true, cell: office => dateFormat.format(new Date(office.createdAt)) },
        ]} />
      </AdminBlock>
    </AdminGrid>
  </>;
}

export default officePage('/app/admin/clients', PlatformClientsPage, AdminCanvas);
