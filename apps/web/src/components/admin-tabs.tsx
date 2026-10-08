"use client";

import Link from "next/link";
import { usePathname } from "@/components/lume/canvas-navigation";
import { adminSections } from "@/lib/navigation";
import { sectionTab, sectionTabRow } from "@/components/section-tabs";

/** The administration's sections. `newTickets` puts the count of new feedback beside Feedback. */
export function AdminTabs({ newTickets = 0 }: { newTickets?: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Seções da administração" className={sectionTabRow}>
      {adminSections.map((section) => {
        const href = `/app/admin/${section.slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={section.slug} href={href} aria-current={active ? "page" : undefined} className={sectionTab(active)}>
            {section.label}
            {section.slug === "feedback" && newTickets > 0 && (
              <span className="ml-1.5 font-mono text-[12.5px] text-muted-foreground">
                {newTickets}<span className="sr-only"> {newTickets === 1 ? "novo" : "novos"}</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
