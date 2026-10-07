'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Calendar, FileText, HardDrive, Mail, type LucideIcon } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import type { CapabilityOutput } from '@/lib/capabilities/contracts';
import { Field } from '@/components/canvas/canvas-controls';
import { CanvasHeader, CanvasPage, CanvasSection } from '@/components/canvas/canvas-page';
import { Button } from '@/components/ui/button';
import { sectionTab, sectionTabRow } from '@/components/section-tabs';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { googleCall, type GoogleStatus } from './client';

type Policy = CapabilityOutput<'k5_google_get_policy'>;
type Module = GoogleStatus['modules'][number]['module'];
type Tab = 'connections' | 'policy';

const selectStyle = 'h-11 w-full rounded-md border bg-background text-[13.5px] md:h-9';
const moduleIcons: Record<Module, LucideIcon> = { gmail: Mail, calendar: Calendar, drive: HardDrive, docs: FileText };
const limits: Record<string, string> = {
  dailyLimit: 'Ações automáticas por dia', maxRecipients: 'Destinatários por ação',
  maxAttachments: 'Anexos por ação', maxAttachmentBytes: 'Tamanho total (MB)',
};
const callbackMessages: Record<string, string> = {
  connected: 'Conta Google conectada.',
  partial: 'Conta conectada com acesso parcial. Autorize os recursos que deseja usar.',
  denied: 'A autorização foi cancelada no Google.',
  invalid: 'A autorização expirou ou mudou. Inicie a conexão novamente.',
  other_account: 'Use a conta já conectada ou desconecte-a antes de trocar.',
  account_in_use: 'Esta conta Google já está vinculada a outro integrante.',
  failed: 'Não foi possível concluir a conexão. Tente novamente.',
  not_configured: 'A integração Google ainda não foi configurada neste ambiente.',
};

function moduleState(status: GoogleStatus, item: GoogleStatus['modules'][number]) {
  if (!status.configured) return 'Aguardando configuração da plataforma';
  if (!item.rolledOut) return 'Ainda não liberado';
  if (!item.enabledByOffice) return 'Desativado pelo escritório';
  if (status.connection?.status === 'reauth_required') return 'Reconexão necessária';
  if (item.granted) return 'Conectado';
  return status.connection ? 'Acesso não autorizado' : 'Não conectado';
}

/** Integrações: the person's Google account and resources, and below them the office's other connections (`children`). */
export function IntegrationsPanel({ children }: { children?: ReactNode }) {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>('connections');
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [disconnect, setDisconnect] = useState(false);

  const refresh = useCallback(async () => {
    const [connection, rules] = await Promise.all([
      googleCall<GoogleStatus>('status'),
      googleCall<Policy>('policy'),
    ]);
    setStatus(connection);
    setPolicy(rules);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      googleCall<GoogleStatus>('status'),
      googleCall<Policy>('policy'),
    ]).then(([connection, rules]) => {
      if (active) { setStatus(connection); setPolicy(rules); }
    }).catch(failure => {
      if (active) setError(failure instanceof Error ? failure.message : 'Não foi possível carregar as integrações.');
    });
    return () => { active = false; };
  }, []);

  async function perform(name: string, action: () => Promise<void>) {
    setBusy(name); setError(''); setNotice('');
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível concluir.'); }
    finally { setBusy(''); }
  }

  async function connect(module: Module) {
    await perform(module, async () => {
      const response = await fetch('/api/integrations/google/connect', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modules: [module] }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível abrir a autorização do Google.');
      window.location.assign(body.url);
    });
  }

  function selectTab(next: Tab, index: number) {
    setTab(next);
    tabButtons.current[index]?.focus();
  }

  function updateRule(action: keyof Policy['rules']['actions'], field: string, value: string) {
    setPolicy(previous => {
      if (!previous) return previous;
      const next = structuredClone(previous);
      const rule = next.rules.actions[action];
      if (field === 'mode') rule.mode = value as typeof rule.mode;
      else {
        const key = field as Exclude<keyof typeof rule, 'mode'>;
        rule[key] = value === '' ? null : Number(value) * (field === 'maxAttachmentBytes' ? 1024 * 1024 : 1);
      }
      return next;
    });
  }

  const quiet = 'text-[13.5px] text-muted-foreground';
  const control = 'h-11 md:h-[34px]';
  const callback = notice || callbackMessages[params.get('google') ?? ''];
  return <CanvasPage className="md:gap-8">
    <div className="flex flex-col gap-4 md:gap-5">
      <CanvasHeader eyebrow="Contas e serviços ligados ao Lume" title="Integrações" />
      <div role="tablist" aria-label="Áreas de integrações" className={sectionTabRow}>
        {([['connections', 'Conexões'], ['policy', 'Regras do escritório']] as const).map(([value, label], index) => <button
          key={value} ref={element => { tabButtons.current[index] = element; }} type="button" role="tab"
          id={`integrations-tab-${value}`} aria-controls={`integrations-panel-${value}`}
          aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
          className={sectionTab(tab === value)}
          onClick={() => setTab(value)}
          onKeyDown={event => {
            const next = event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? (index + 1) % 2 : event.key === 'Home' ? 0 : event.key === 'End' ? 1 : null;
            if (next !== null) { event.preventDefault(); selectTab(next === 0 ? 'connections' : 'policy', next); }
          }}
        >{label}</button>)}
      </div>
    </div>
    {error && <p role="alert" className="text-[13.5px] text-destructive">{error}</p>}
    {callback && <p role="status" className="text-[13.5px]">{callback}</p>}
    <div id="integrations-panel-connections" role="tabpanel" aria-labelledby="integrations-tab-connections" hidden={tab !== 'connections'} className="flex flex-col gap-10">
      <CanvasSection title="Google" label="Conta Google" action={status && <span className="truncate text-[13px] text-muted-foreground">
        {status.connection ? `${status.connection.email} · ${status.connection.status === 'active' ? 'conectada' : 'reconexão necessária'}` : 'Nenhuma conta conectada'}</span>}>
        {!status ? error ? <div><Button variant="outline" size="lg" className={control} disabled={Boolean(busy)} onClick={() => void perform('refresh', refresh)}>Tentar novamente</Button></div>
          : <p role="status" className={quiet}>Carregando integrações…</p> : <>
          <p className={quiet}>Autorize cada recurso separadamente. E-mails, arquivos e agenda pessoal não são compartilhados com os demais integrantes do escritório.</p>
          {!status.configured && <p className="text-[13.5px]">A integração Google ainda não foi configurada neste ambiente. O responsável pela plataforma precisa configurar o projeto Google Cloud.</p>}
          <div role="list" aria-label="Recursos do Google" className="flex flex-col gap-0.5">
            {status.modules.map(item => {
              const available = status.configured && item.rolledOut && item.enabledByOffice;
              const connected = status.connection?.status === 'active' && item.granted;
              const action = status.connection?.status === 'reauth_required' || connected ? 'Reconectar' : 'Conectar';
              const Icon = moduleIcons[item.module];
              return <div role="listitem" key={item.module} className="-mx-2 flex min-h-14 items-center gap-3 rounded-[10px] px-2 py-2 md:-mx-3 md:rounded-md md:px-3">
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-sm font-medium">{item.label}</span>
                  <span className="truncate text-[12.5px] text-muted-foreground">{moduleState(status, item)}</span>
                </span>
                <Button variant="outline" size="lg" className={control} aria-label={`${action} ${item.label}`} disabled={!available || Boolean(busy)} onClick={() => void connect(item.module)}>
                  {busy === item.module ? 'Abrindo Google…' : action}
                </Button>
              </div>;
            })}
          </div>
          <p className="text-xs text-muted-foreground">Drive e Docs usam a mesma permissão do Google; ao autorizar um, o outro também pode aparecer como conectado. Sair do Lume encerra sua sessão, mas a sincronização continua.</p>
          {status.connection && <div className="flex flex-col items-start gap-2">
            <Button variant="outline" size="lg" className={control} disabled={Boolean(busy)} onClick={() => setDisconnect(true)}>Desconectar conta Google</Button>
            <p className="text-xs text-muted-foreground">A desconexão encerra o acesso de todas as integrações. Cópias já importadas permanecem no Cofre.</p>
          </div>}
        </>}
      </CanvasSection>
      {children}
    </div>
    <div id="integrations-panel-policy" role="tabpanel" aria-labelledby="integrations-tab-policy" hidden={tab !== 'policy'}>
      {!status || !policy ? <p role="status" className={quiet}>Carregando regras…</p> : <CanvasSection title="Regras do escritório" label="Regras do escritório">
        <p className={quiet}>Valem para a interface e para o Lume. Ações automáticas acima dos limites pedem confirmação. Bloqueios sempre prevalecem.</p>
        <fieldset className="flex flex-wrap gap-x-6" disabled={Boolean(busy)}>
          <legend className="mb-1.5 text-xs text-muted-foreground">Recursos permitidos</legend>
          {status.modules.map(item => <label key={item.module} className="flex min-h-11 items-center gap-2.5 text-[13.5px] md:min-h-8">
            <input type="checkbox" className="size-4 accent-foreground" checked={policy.rules.modules[item.module]}
              onChange={event => { const checked = event.target.checked; setPolicy(previous => previous ? { ...previous, rules: { ...previous.rules, modules: { ...previous.rules.modules, [item.module]: checked } } } : previous); }} />
            {item.label}</label>)}
        </fieldset>
        <div className="flex flex-col">{policy.actions.map(item => { const rule = policy.rules.actions[item.action]; return <fieldset key={item.action} disabled={Boolean(busy)} className="grid gap-3 py-4 md:grid-cols-[minmax(180px,1fr)_2fr] md:items-start">
          <legend className="sr-only">{item.label}</legend>
          <label className="pt-2 text-sm font-medium" htmlFor={`mode-${item.action}`}>{item.label}</label>
          <div className="flex flex-col gap-3">
            <select className={selectStyle} id={`mode-${item.action}`} value={rule.mode} onChange={event => updateRule(item.action, 'mode', event.target.value)}>
              <option value="blocked">Bloqueada</option><option value="confirmation">Exige confirmação</option><option value="automatic">Automática dentro dos limites</option></select>
            {rule.mode === 'automatic' && <div className="grid gap-3 sm:grid-cols-2">{item.limits.map(limit => { const value = rule[limit as keyof typeof rule]; return <Field key={limit} label={limits[limit]} htmlFor={`limit-${item.action}-${limit}`}>
              <Input id={`limit-${item.action}-${limit}`} type="number" min={limit === 'maxRecipients' ? 1 : 0} step={limit === 'maxAttachmentBytes' ? '0.1' : '1'} className="h-11 md:h-9"
                value={value === null ? '' : Number(value) / (limit === 'maxAttachmentBytes' ? 1024 * 1024 : 1)} placeholder="Limite técnico" onChange={event => updateRule(item.action, limit, event.target.value)} /></Field>; })}</div>}
          </div>
        </fieldset>; })}</div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" className={control} disabled={Boolean(busy)} onClick={() => void perform('policy', async () => { const saved = await googleCall<Policy>('policy-save', { version: policy.version, rules: policy.rules }); setPolicy(saved); await refresh(); setNotice('Regras salvas.'); })}>{busy === 'policy' ? 'Salvando…' : 'Salvar regras'}</Button>
          <p className="text-xs text-muted-foreground">Versão {policy.version} · Máximo técnico: 500 ações/dia, 100 destinatários, 10 anexos e 25 MB.</p>
        </div>
      </CanvasSection>}
    </div>
    <Dialog open={disconnect} onOpenChange={setDisconnect}><DialogContent><DialogHeader><DialogTitle>Desconectar a conta Google?</DialogTitle><DialogDescription>O Lume interromperá a sincronização e revogará o acesso a todas as integrações. Os arquivos já importados permanecem no Cofre.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={Boolean(busy)} onClick={() => setDisconnect(false)}>Cancelar</Button><Button disabled={Boolean(busy)} onClick={() => void perform('disconnect', async () => { const response = await fetch('/api/integrations/google/disconnect', { method: 'POST' }); if (!response.ok) throw new Error((await response.json()).error); setDisconnect(false); await refresh(); setNotice('Conta desconectada.'); })}>{busy === 'disconnect' ? 'Desconectando…' : 'Desconectar'}</Button></DialogFooter></DialogContent></Dialog>
  </CanvasPage>;
}
