"use client";

import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const NONE = "Sem modelo";

/** Model ids known to the router, plus anything the admin types: a new model works before we ship an update. */
export function ModelPicker({ id, value, models, onChange }: { id: string; value: string; models: string[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const typed = query.trim();
  function pick(next: string) { onChange(next); setOpen(false); setQuery(""); }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className="h-11 w-full justify-between font-normal md:h-9">
        <span className={cn("truncate", !value && "text-muted-foreground")}>{value || NONE}</span>
        <ChevronsUpDown className="shrink-0 opacity-50" aria-hidden="true" />
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
      <Command>
        <CommandInput placeholder="Buscar ou digitar o ID" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>Nenhum modelo conhecido com esse nome.</CommandEmpty>
          {typed && !models.includes(typed) && <CommandGroup>
            <CommandItem value={typed} onSelect={() => pick(typed)}>Usar &ldquo;{typed}&rdquo;</CommandItem>
          </CommandGroup>}
          <CommandGroup>
            <CommandItem value={NONE} data-checked={!value} onSelect={() => pick("")}>{NONE}</CommandItem>
            {models.map((model) => <CommandItem key={model} value={model} data-checked={model === value} onSelect={() => pick(model)}>{model}</CommandItem>)}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
