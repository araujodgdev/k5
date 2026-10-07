"use client";

import { useEffect, useState } from "react";
import { useAui } from "@assistant-ui/react";
import { CalendarClock, CalendarDays, FilePen, FileSearch, FileText, Gavel, ListChecks, Quote, Scale, Wallet, type LucideIcon } from "lucide-react";
import { LiveLumeMark } from "@/components/live-lume-mark";
import type { CanvasSubject } from "@/components/shell/shell-context";
import { agendaCall } from "@/lib/agenda-client";

type Suggestion = { icon: LucideIcon; text: string };

const OFFICE: Suggestion[] = [
  { icon: CalendarDays, text: "O que tenho para hoje?" },
  { icon: Gavel, text: "Há publicações novas nos meus processos?" },
  { icon: Wallet, text: "Quanto tenho a receber este mês?" },
  { icon: Scale, text: "Pesquisar jurisprudência para um caso" },
];

const BY_MODULE: Record<string, Suggestion[]> = {
  agenda: [
    { icon: CalendarDays, text: "O que tenho para hoje?" },
    { icon: ListChecks, text: "Quais tarefas estão atrasadas?" },
    { icon: CalendarClock, text: "Quais reuniões tenho esta semana?" },
  ],
  honorarios: [
    { icon: Wallet, text: "Quanto tenho a receber este mês?" },
    { icon: ListChecks, text: "Quais parcelas estão atrasadas?" },
  ],
  research: [
    { icon: Scale, text: "Pesquisar jurisprudência do STJ sobre um tema" },
    { icon: Quote, text: "Conferir as citações de um texto" },
  ],
};

/** Only what the Lume can do from where the person is: it reads the case or document the canvas shows. */
function suggestionsFor(subject: CanvasSubject | null): Suggestion[] {
  if (subject?.kind === "case") return [
    { icon: FileSearch, text: "Resuma este caso" },
    { icon: CalendarClock, text: "Quais são os próximos prazos deste caso?" },
    { icon: Scale, text: "Pesquise jurisprudência para este caso" },
    { icon: FilePen, text: "Redija uma petição para este caso" },
  ];
  if (subject?.kind === "document") return [
    { icon: FileText, text: "Revise este documento" },
    { icon: Quote, text: "Confira as citações deste documento" },
    { icon: FileSearch, text: "Resuma este documento" },
  ];
  if (subject?.kind === "module") return BY_MODULE[subject.slug.split(":")[0]] ?? OFFICE;
  return OFFICE;
}

function greeting(hour: number) {
  return hour < 5 ? "Boa noite" : hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
}

const plural = (count: number, one: string, many: string) => count === 1 ? one : many.replace("#", String(count));

const ASK = "Por onde começamos?";
const DAY_KEY = "lume:day";

/** The last sentence this tab read, so a new conversation or a reload paints it at once. */
function storedDay(): string {
  try {
    const saved = JSON.parse(sessionStorage.getItem(DAY_KEY) ?? "null") as { date: string; text: string } | null;
    return saved?.date === new Date().toDateString() ? saved.text : "";
  } catch {
    return "";
  }
}

/** One true sentence about the person's day, from the agenda: what is due and the next meeting. */
function useDaySentence() {
  const [day, setDay] = useState(storedDay);
  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const night = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    Promise.all([
      agendaCall("k5_agenda_list_activities", { kind: "task", openOnly: true, dueTo: today, limit: 1 }),
      agendaCall("k5_agenda_list_activities", { kind: "meeting", status: "pending", from: now.toISOString(), to: night.toISOString(), limit: 1 }),
    ]).then(([tasks, meetings]) => {
      if (cancelled) return;
      const parts = [];
      if (tasks.total) parts.push(plural(tasks.total, "uma tarefa vence até hoje", "# tarefas vencem até hoje"));
      const next = meetings.activities[0]?.startsAt;
      if (next) {
        const time = new Date(next).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        parts.push(meetings.total > 1 ? `há ${meetings.total} reuniões, a próxima às ${time}` : `há uma reunião às ${time}`);
      }
      const line = parts.length ? parts.join(" e ") : "nada vence hoje na sua agenda";
      const text = `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
      setDay(text);
      try { sessionStorage.setItem(DAY_KEY, JSON.stringify({ date: now.toDateString(), text })); } catch { /* Only a faster first paint is lost. */ }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  // Until the agenda answers, the question stands alone; the day joins it in front.
  return day ? `${day} ${ASK}` : ASK;
}

/** The empty conversation: the mark, a greeting by name and hour, the day in one line, and what to ask. */
export function EmptyState({ userName, subject }: { userName: string; subject: CanvasSubject | null }) {
  const aui = useAui();
  const sentence = useDaySentence();
  const firstName = userName.trim().split(/\s+/)[0];
  const suggestions = suggestionsFor(subject);
  return (
    <div className="flex flex-1 flex-col justify-end gap-[22px] pb-1">
      <div className="flex flex-col gap-3">
        <LiveLumeMark state="idle" width={40} height={40} />
        <h2 suppressHydrationWarning className="text-[21px] leading-tight font-semibold tracking-[-0.02em]">
          {greeting(new Date().getHours())}{firstName ? `, ${firstName}` : ""}.
        </h2>
        <p className="text-[15px] leading-[1.6] text-muted-foreground">{sentence}</p>
      </div>
      <ul aria-label="Sugestões" className="flex flex-col gap-0.5">
        {suggestions.map(({ icon: Icon, text }) => (
          <li key={text}>
            <button type="button" onClick={() => { const composer = aui.composer(); const draft = composer.getState().text; composer.setText(draft.trim() ? `${draft}\n${text}` : text); document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Pergunte ao Lume"]')?.focus(); }}
              className="-mx-2.5 flex min-h-10 w-[calc(100%+20px)] items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11 max-md:text-[15px]">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
