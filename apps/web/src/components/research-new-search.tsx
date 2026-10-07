'use client';

import Link from 'next/link';
import { Plus, Scale, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/** The module's action: a jurisprudence or a trademark search. */
export function NewResearchMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="lg" className="h-11 md:h-[34px]"><Plus className="size-3.5" aria-hidden="true" />Nova pesquisa</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild><Link href="/app/research?mode=jurisprudence"><Scale aria-hidden="true" />Jurisprudência</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/app/research?mode=trademarks"><Search aria-hidden="true" />Marca</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
