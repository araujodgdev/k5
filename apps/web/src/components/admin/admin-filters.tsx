"use client";

import Link from "next/link";
import { useRouter } from "@/components/lume/canvas-navigation";
import { Check } from "lucide-react";
import { Chip } from "@/components/canvas/canvas-controls";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type AdminFilterOption = { label: string; href: string; selected: boolean };

/** A filter chip that opens its choices. Each choice is a link that keeps the other filters. */
export function AdminFilterMenu({ label, active, options }: { label: string; active: boolean; options: AdminFilterOption[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip menu pressed={active}>{label}</Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-80 overflow-y-auto">
        {options.map(option => (
          <DropdownMenuItem key={option.href} asChild>
            <Link href={option.href} aria-current={option.selected ? "true" : undefined}>
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.selected && <Check aria-hidden />}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A filter chip that is on or off; choosing it loads the section with that filter. */
export function AdminFilterChip({ href, pressed, children }: { href: string; pressed: boolean; children: React.ReactNode }) {
  const router = useRouter();
  return <Chip pressed={pressed} onClick={() => router.push(href)}>{children}</Chip>;
}
