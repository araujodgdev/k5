import { listOfficesForPlatform } from "@/lib/ai-connections-core";
import { requirePlatformPage } from "@/lib/platform";
import { notFound } from "next/navigation";

export const metadata = { title: "Clientes · Administração" };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "America/Sao_Paulo" });

/** The offices on the platform. Their AI is configured once, in the IA tab. */
export default async function PlatformClientsPage() {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const offices = await listOfficesForPlatform(context.db);
  return (
    <section>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="border-b text-muted-foreground text-[13px]"><tr><th className="py-3 pr-4 font-normal">Escritório</th><th className="px-4 py-3 text-right font-normal">Pessoas</th><th className="hidden py-3 pl-4 text-right font-normal sm:table-cell">Desde</th></tr></thead>
          <tbody>{offices.map((office) => (
            <tr key={office.id} className="border-b last:border-0">
              <td className="py-4 pr-4 font-medium">{office.name}<span className="mt-1 block font-normal text-muted-foreground text-[13px] sm:hidden">Desde {dateFormat.format(new Date(office.createdAt))}</span></td>
              <td className="px-4 py-4 text-right tabular-nums text-muted-foreground">{Number(office.memberCount)}</td>
              <td className="hidden py-4 pl-4 text-right text-muted-foreground sm:table-cell">{dateFormat.format(new Date(office.createdAt))}</td>
            </tr>
          ))}</tbody>
        </table>
        {offices.length === 0 && <p className="py-12 text-subtle-foreground">Nenhum escritório cadastrado.</p>}
      </div>
    </section>
  );
}
