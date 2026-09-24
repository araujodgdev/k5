import Link from "next/link";
import { listOfficesForPlatform } from "@/lib/ai-connections-core";
import { requirePlatformPage } from "@/lib/platform";
import { notFound } from "next/navigation";

export const metadata = { title: "Clientes · Administração" };

export default async function PlatformClientsPage() {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const offices = await listOfficesForPlatform(context.db);
  return (
    <section>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="border-b text-muted-foreground text-[13px]"><tr><th className="py-3 pr-4 font-normal">Escritório</th><th className="hidden px-4 py-3 font-normal sm:table-cell">Conexões</th><th className="hidden px-4 py-3 font-normal sm:table-cell">Ativas</th><th className="py-3 pl-4 text-right font-normal">Configuração</th></tr></thead>
          <tbody>{offices.map((office) => (
            <tr key={office.id} className="border-b last:border-0">
              <td className="py-4 pr-4 font-medium">{office.name}<span className="mt-1 block font-normal text-muted-foreground text-[13px] sm:hidden">{office.connectionCount} conexões · {office.enabledConnectionCount} ativas</span></td>
              <td className="hidden px-4 py-4 text-muted-foreground sm:table-cell">{office.connectionCount}</td>
              <td className="hidden px-4 py-4 text-muted-foreground sm:table-cell">{office.enabledConnectionCount}</td>
              <td className="py-4 pl-4 text-right"><Link href={`/app/admin/clients/${office.id}/ai`} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-2 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 md:min-h-8">Gerenciar IA</Link></td>
            </tr>
          ))}</tbody>
        </table>
        {offices.length === 0 && <p className="py-12 text-subtle-foreground">Nenhum escritório cadastrado.</p>}
      </div>
    </section>
  );
}
