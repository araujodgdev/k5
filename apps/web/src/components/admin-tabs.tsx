"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminSections } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Administração" className="-mx-5 flex gap-1 overflow-x-auto border-b px-5 md:mx-0 md:mt-4 md:px-0">
      {adminSections.map((section) => {
        const href = `/app/admin/${section.slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={section.slug} href={href} aria-current={active ? "page" : undefined}
            className={cn("relative inline-flex min-h-11 shrink-0 items-center px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring md:min-h-10",
              active ? "font-medium text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-brand" : "text-muted-foreground hover:text-foreground")}>
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
