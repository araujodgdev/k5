import { ArrowUp, ArrowUpRight, Check, FileText, Mic, Paperclip } from "lucide-react";
import { navIcons, navTone } from "@/components/nav-icons";
import { TisesMark } from "@/components/tises-logo";
import { cn } from "@/lib/utils";

/*
 * Small, faithful drawings of the real screens for the landing's modules. They are
 * illustrations (aria-hidden); the text beside them carries the words.
 */

const rail = ["command-center", "agents", "vault", "research", "agenda"] as const;

function Bar({ title }: { title: string }) {
  return <div className="flex h-11 shrink-0 items-center border-b border-border px-5 text-[15px] font-medium tracking-[-0.03em]">{title}</div>;
}

function AgentScreen() {
  return (
    <div className="flex h-full flex-col">
      <Bar title="Tises" />
      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-5 text-[13px] leading-relaxed">
        <p className="ml-auto max-w-[78%] bg-muted px-3 py-2">Prepare a contestação do caso Silva a partir dos documentos do Cofre.</p>
        <div className="flex flex-col gap-1.5 text-muted-foreground">
          <p className="flex items-center gap-2"><Check className="size-3.5 text-brand-ink" />Leu 6 documentos do caso</p>
          <p className="flex items-center gap-2"><Check className="size-3.5 text-brand-ink" />Criou “Contestação — Silva”<span className="label-mono ml-auto text-foreground">Abrir</span></p>
        </div>
        <p>Redigi a contestação com base na petição inicial e no contrato. Duas citações pedem conferência antes do protocolo.</p>
        <p className="border-l-2 border-brand pl-3">Substituir o rascunho anterior da contestação?</p>
      </div>
      <div className="m-4 mt-0 flex items-center gap-3 border border-line px-3 py-2.5 text-muted-foreground">
        <span className="flex-1 text-[13px] text-subtle-foreground">Pergunte ao Tises</span>
        <Paperclip className="size-3.5" /><Mic className="size-3.5" />
        <span className="grid size-6 place-items-center bg-foreground text-background"><ArrowUp className="size-3.5" /></span>
      </div>
    </div>
  );
}

function VaultScreen() {
  const files = [["Petição inicial.pdf", "12 pág."], ["Contrato de financiamento.pdf", "Escaneado"], ["Procuração.pdf", "2 pág."], ["Laudo pericial.docx", "18 pág."], ["Comprovantes de pagamento.pdf", "Escaneado"]];
  return (
    <div className="flex h-full flex-col">
      <Bar title="Silva × Banco Horizonte" />
      <p className="label-mono border-b border-border px-5 py-2.5 text-subtle-foreground">Cofre / Casos / Silva</p>
      <ul className="text-[13px]">
        {files.map(([name, meta]) => (
          <li key={name} className="flex items-center gap-3 border-b border-border px-5 py-3">
            <FileText className="size-4 text-module-vault" />{name}<span className="label-mono ml-auto text-subtle-foreground">{meta}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResearchScreen() {
  const results = [
    ["stj.jus.br · 2024", "Juros remuneratórios acima da taxa média de mercado", "A abusividade deve ser demonstrada no caso concreto, considerando a taxa média praticada à época da contratação."],
    ["tjsp.jus.br · 2025", "Revisão de contrato de financiamento de veículo", "Mantida a revisão das tarifas não previstas em contrato, com devolução simples dos valores pagos."],
  ];
  return (
    <div className="flex h-full flex-col">
      <Bar title="Pesquisa" />
      <div className="p-5 pb-2"><p className="border border-line px-3 py-2.5 text-[13px]">Revisão de juros em financiamento de veículo</p></div>
      <ul className="text-[13px]">
        {results.map(([site, title, excerpt]) => (
          <li key={title} className="flex flex-col gap-1 border-b border-border px-5 py-3.5">
            <span className="label-mono text-subtle-foreground">{site}</span>
            <span className="flex items-center gap-1.5 font-medium">{title}<ArrowUpRight className="size-3.5 text-module-research" /></span>
            <span className="line-clamp-2 text-muted-foreground">{excerpt}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgendaScreen() {
  const days = [
    ["Hoje", [["Prazo", "Contestação — Silva × Banco Horizonte"], ["16:30", "Ligar para a cliente sobre o laudo"]]],
    ["Amanhã", [["10:00", "Reunião com Marina Costa"], ["Prazo", "Réplica — Oliveira × Construtora"]]],
  ] as const;
  return (
    <div className="flex h-full flex-col">
      <Bar title="Escritório" />
      <div className="text-[13px]">
        {days.map(([day, rows]) => (
          <div key={day}>
            <p className="label-mono border-b border-border px-5 pt-4 pb-2 text-subtle-foreground">{day}</p>
            {rows.map(([when, title]) => (
              <p key={title} className="flex items-center gap-4 border-b border-border px-5 py-3">
                <span className="label-mono w-12 text-schedule">{when}</span>{title}
              </p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const screens = [AgentScreen, VaultScreen, ResearchScreen, AgendaScreen];

/** The icon rail of the app shell; the active module sits on the ink block. */
function ScreenRail({ active }: { active?: number }) {
  return (
    <div className="flex w-12 shrink-0 flex-col border-r border-line">
      <div className="grid h-11 place-items-center border-b border-line bg-foreground">
        <TisesMark className="size-4 text-background" />
      </div>
      {rail.map((slug, index) => {
        const Icon = navIcons[slug];
        return (
          <span key={slug} data-active={index - 1 === active || undefined}
            className={cn("grid h-10 place-items-center transition-colors duration-500 ease-(--ease) data-active:bg-foreground data-active:text-background", navTone[slug])}>
            <Icon className="size-4" />
          </span>
        );
      })}
    </div>
  );
}

/** A single screen in its frame. */
export function ScreenFrame({ index, className }: { index: number; className?: string }) {
  const Screen = screens[index];
  return (
    <div aria-hidden="true" className={cn("flex h-80 overflow-hidden border border-line bg-background shadow-(--shadow-float) md:h-[27rem]", className)}>
      <ScreenRail active={index} />
      <div className="min-w-0 flex-1"><Screen /></div>
    </div>
  );
}
