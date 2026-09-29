"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminSections } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { sectionTab, sectionTabGrid } from "@/components/section-tabs";

export function AdminTabs() {
  const pathname = usePathname();
  return (
    // On a phone every tab shows in a 3-column grid instead of a strip that scrolls and cuts words.
    <nav aria-label="Administração" className={cn(sectionTabGrid, "md:mt-4")}>
      {adminSections.map((section) => {
        const href = `/app/admin/${section.slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={section.slug} href={href} aria-current={active ? "page" : undefined}
            className={sectionTab(active)}>
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
