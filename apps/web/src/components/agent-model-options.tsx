"use client";

import { Check } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { OfficeModelOption } from "./agent-chat";

export function AgentModelOptions({ models, value, onChange }: { models: OfficeModelOption[]; value: string; onChange: (value: string) => void }) {
  return (
        <Command>
          <CommandInput placeholder="Buscar modelo" />
          <CommandList>
            <CommandEmpty>Nenhum modelo com esse nome.</CommandEmpty>
            <CommandGroup>
              {models.map((model) => {
                const key = `${model.provider}:${model.modelId}`;
                return (
                  <CommandItem key={key} value={`${model.providerLabel} ${model.modelId}`} onSelect={() => { onChange(key); }}>
                    <Check className={`size-4 shrink-0 ${key === value ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{model.modelId}</span>
                      <span className="block truncate text-xs text-muted-foreground">{model.providerLabel}</span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
  );
}
