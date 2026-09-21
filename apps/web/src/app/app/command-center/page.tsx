import { JudicialInbox } from "@/components/judicial-inbox";
import { Reveal } from "@/components/reveal";
import { requireWorkspace } from "@/lib/session";

export const metadata = { title: "Central de comando" };

type Props = { searchParams: Promise<{ caso?: string }> };

/**
 * The static segment takes precedence over `[section]`, which keeps its "Em breve" placeholder for
 * the sections that really have nothing yet.
 */
export default async function CommandCenterPage({ searchParams }: Props) {
  const { office } = await requireWorkspace();
  const { caso } = await searchParams;
  return (
    <Reveal className="mx-auto w-full max-w-5xl px-5 py-6 md:px-12 md:py-11">
      <h1 className="display text-[30px] md:text-[28px]" data-reveal>Central de comando</h1>
      <div data-reveal>
        <JudicialInbox canWrite={(office).role !== "reviewer"} initialCaseId={caso} />
      </div>
    </Reveal>
  );
}
