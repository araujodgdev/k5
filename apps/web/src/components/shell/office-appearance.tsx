'use client';

import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { accentLabels, officeAccents, type OfficeAccent } from '@/lib/appearance-contract';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';

type Appearance = { accent: OfficeAccent; pending: boolean; error: string; choose(accent: OfficeAccent): Promise<void> };
const AppearanceContext = createContext<Appearance | null>(null);

export function OfficeAppearance({ initialAccent, children }: { initialAccent: OfficeAccent; children: ReactNode }) {
  const [accent, setAccent] = useState(initialAccent);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  async function choose(next: OfficeAccent) {
    if (saving.current || next === accent) return;
    saving.current = true;
    const previous = accent;
    setAccent(next); setPending(true); setError('');
    try {
      const response = await fetch('/api/profile/appearance', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accent: next }) });
      if (!response.ok) throw new Error('Não foi possível salvar sua cor. Tente novamente.');
    } catch {
      setAccent(previous);
      setError('Não foi possível salvar sua cor. Tente novamente.');
    } finally { saving.current = false; setPending(false); }
  }
  return <AppearanceContext value={{ accent, pending, error, choose }}><div className="contents" data-office-accent={accent}>{children}</div></AppearanceContext>;
}

export function AccentChoice({ menu = false }: { menu?: boolean }) {
  const appearance = useContext(AppearanceContext);
  if (!appearance) return null;
  const { accent, pending, error, choose } = appearance;
  return <div className="px-3 py-2">
    <p className="mb-2 text-xs text-muted-foreground">Cor do Lume</p>
    {menu ? <DropdownMenuPrimitive.RadioGroup aria-label="Cor do Lume" value={accent} onValueChange={next => { void choose(next as OfficeAccent); }}>
      {officeAccents.map(value => <DropdownMenuPrimitive.RadioItem key={value} value={value} disabled={pending} onSelect={event => { event.preventDefault(); void choose(value); }}
        className="flex min-h-9 cursor-default items-center gap-2 rounded-md px-3 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring data-highlighted:bg-accent data-[state=checked]:bg-brand-soft data-disabled:opacity-50">
        <span className="w-3" aria-hidden="true">{accent === value ? '●' : ''}</span>{accentLabels[value]}
      </DropdownMenuPrimitive.RadioItem>)}
    </DropdownMenuPrimitive.RadioGroup> : <div role="radiogroup" aria-label="Cor do Lume" className="grid grid-cols-4 gap-1">
      {officeAccents.map((value, index) => <button key={value} type="button" role="radio" aria-checked={accent === value} tabIndex={accent === value ? 0 : -1} aria-disabled={pending}
        className="min-h-11 rounded-md border border-border px-1 text-xs aria-checked:border-ring aria-checked:bg-brand-soft focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => void choose(value)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % officeAccents.length
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index + officeAccents.length - 1) % officeAccents.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? officeAccents.length - 1 : null;
          if (next === null) return;
          event.preventDefault();
          (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
          void choose(officeAccents[next]);
        }}>{accentLabels[value]}</button>)}
    </div>}
    {pending && <p role="status" className="mt-1 text-xs text-muted-foreground">Salvando cor…</p>}
    {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
  </div>;
}
