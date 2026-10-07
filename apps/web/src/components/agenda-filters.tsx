'use client';

import type { ReactNode } from 'react';
import { Check, Search } from 'lucide-react';
import { Chip } from '@/components/canvas/canvas-controls';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type FilterOption = { value: string; label: string };

/**
 * A filter chip that opens its choices (the prototype's "Situação: Abertos" chip). The first option
 * is the unfiltered one; with another chosen the chip names it and takes the selected fill.
 */
export function FilterMenu({ label, value, options, onChange }: { label: string; value: string; options: readonly FilterOption[]; onChange: (value: string) => void }) {
  const chosen = options.find(option => option.value === value);
  const active = Boolean(chosen) && chosen !== options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip menu pressed={active} aria-label={`${label}: ${chosen?.label ?? options[0]?.label}`}>
          <span className="max-w-48 truncate">{active ? `${label}: ${chosen!.label}` : label}</span>
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-80 overflow-y-auto">
        {options.map(option => (
          <DropdownMenuItem key={option.value} role="menuitemradio" aria-checked={option.value === value} onSelect={() => onChange(option.value)}>
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.value === value && <Check aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The 34px search field of the prototype's module headers: a hairline box with the glass inside. */
export function SearchField({ label, value, onChange, className }: { label: string; value: string; onChange: (value: string) => void; className?: string }) {
  return (
    <label className={cn('flex h-11 min-w-0 items-center gap-2 rounded-md border border-input px-2.5 text-muted-foreground focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 md:h-[34px] md:w-60', className)}>
      <Search aria-hidden="true" className="size-3.5 shrink-0" />
      <input type="search" aria-label={label} placeholder={label} value={value} onChange={event => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-subtle-foreground md:text-[13.5px]" />
    </label>
  );
}

/** Two or more options on a sunken pill, the chosen one raised (the prototype's grid and list switch). */
export function Segmented<Value extends string>({ label, value, options, onChange, className }: {
  label: string; value: Value; onChange: (value: Value) => void; className?: string;
  options: readonly { value: Value; label: string; icon?: ReactNode }[];
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex shrink-0 rounded-md bg-muted p-0.5', className)}>
      {options.map(option => (
        <button key={option.value} type="button" aria-pressed={value === option.value} aria-label={option.icon ? option.label : undefined} onClick={() => onChange(option.value)}
          className={cn('flex h-10 min-w-11 items-center justify-center gap-1.5 rounded-sm px-2 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-ring md:h-7 md:min-w-[30px]',
            value === option.value ? 'bg-card font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
          {option.icon ?? option.label}
        </button>
      ))}
    </div>
  );
}
