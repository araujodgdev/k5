import { initials } from "@/lib/profile-contract";
import { cn } from "@/lib/utils";

export type CasePerson = { id: string; name: string };

const MAX_SHOWN = 4;

/** The people on a case as overlapping initials ringed in the card's surface: 22px on cards, 30px in the case header. */
export function PeopleStack({ people, size = "sm", className }: { people: readonly CasePerson[]; size?: "sm" | "lg"; className?: string }) {
  if (!people.length) return null;
  const shown = people.slice(0, MAX_SHOWN);
  const hidden = people.length - shown.length;
  const dot = cn("inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground shadow-[0_0_0_2px_var(--card)]",
    size === "lg" ? "size-[30px] text-[11px]" : "size-[22px] text-[9.5px]");
  return (
    <span className={cn("flex", className)}>
      <span className="sr-only">{`Pessoas no caso: ${people.map((person) => person.name).join(", ")}`}</span>
      {shown.map((person, index) => (
        <span key={person.id} aria-hidden="true" title={person.name} className={cn(dot, index > 0 && "-ml-1.5")}>{initials(person.name)}</span>
      ))}
      {hidden > 0 && <span aria-hidden="true" className={cn(dot, "-ml-1.5")}>{`+${hidden}`}</span>}
    </span>
  );
}
