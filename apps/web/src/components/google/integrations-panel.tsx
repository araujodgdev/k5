'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { CapabilityOutput } from '@/lib/capabilities/contracts';
import type { OfficeRole } from '@/lib/offices';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { googleCall, type GoogleStatus } from './client';

type Policy = CapabilityOutput<'k5_google_get_policy'>;
type Module = GoogleStatus['modules'][number]['module'];
type Tab = 'connections' | 'policy';

const selectStyle = 'h-11 w-full rounded-md border border-input bg-background px-3 text-sm md:h-9';
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

export function IntegrationsPanel({ role }: { role: OfficeRole }) {
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
      role === 'administrator' ? googleCall<Policy>('policy') : Promise.resolve(null),
    ]);
    setStatus(connection);
    setPolicy(rules);
  }, [role]);

  useEffect(() => {
    let active = true;
    Promise.all([
      googleCall<GoogleStatus>('status'),
      role === 'administrator' ? googleCall<Policy>('policy') : Promise.resolve(null),
    ]).then(([connection, rules]) => {
      if (active) { setStatus(connection); setPolicy(rules); }
    }).catch(failure => {
      if (active) setError(failure instanceof Error ? failure.message : 'Não foi possível carregar as integrações.');
    });
    return () => { active = false; };
  }, [role]);

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

  return <div className="mx-auto w-full max-w-5xl space-y-8 px-5 py-6 md:px-10 md:py-10 [&_button]:min-h-11 md:[&_button]:min-h-9">
    <h1 className="page-title max-md:sr-only">Integrações</h1>
    {role === 'administrator' && <div role="tablist" aria-label="Áreas de integrações" className="flex gap-6 border-b">
      {([['connections', 'Conexões'], ['policy', 'Regras do escritório']] as const).map(([value, label], index) => <button
        key={value} ref={element => { tabButtons.current[index] = element; }} type="button" role="tab"
        id={`integrations-tab-${value}`} aria-controls={`integrations-panel-${value}`}
        aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
        className={`border-b-2 pb-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${tab === value ? 'border-brand text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        onClick={() => setTab(value)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? (index + 1) % 2 : event.key === 'Home' ? 0 : event.key === 'End' ? 1 : null;
          if (next !== null) { event.preventDefault(); selectTab(next === 0 ? 'connections' : 'policy', next); }
        }}
      >{label}</button>)}
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {(notice || callbackMessages[params.get('google') ?? '']) && <p role="status" className="text-sm">{notice || callbackMessages[params.get('google') ?? '']}</p>}
    {!status ? error ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => void perform('refresh', refresh)}>Tentar novamente</Button> : <p role="status" className="text-sm text-muted-foreground">Carregando integrações…</p> : <>
      <div id="integrations-panel-connections" role={role === 'administrator' ? 'tabpanel' : undefined} aria-labelledby={role === 'administrator' ? 'integrations-tab-connections' : undefined} hidden={tab !== 'connections'} className="space-y-8">
        <section aria-labelledby="google-account" className="space-y-4">
          <div><h2 id="google-account" className="text-lg font-medium">Conta Google</h2>
            <p className="mt-1 text-sm text-muted-foreground">{status.connection ? `${status.connection.email} · ${status.connection.status === 'active' ? 'Conectada' : 'Reconexão necessária'}` : 'Nenhuma conta conectada.'}</p>
          </div>
          <p className="text-sm text-muted-foreground">Escolha cada integração abaixo para autorizar seu acesso. E-mails, arquivos e agenda pessoal não são compartilhados com os demais integrantes do escritório.</p>
          {!status.configured && <p className="text-sm">A integração Google ainda não foi configurada neste ambiente. O responsável pela plataforma precisa configurar o projeto Google Cloud.</p>}
        </section>
        <section aria-label="Integrações disponíveis" className="divide-y border-y">
          {status.modules.map(item => {
            const available = status.configured && item.rolledOut && item.enabledByOffice;
            const connected = status.connection?.status === 'active' && item.granted;
            const action = status.connection?.status === 'reauth_required' || connected ? 'Reconectar' : 'Conectar';
            return <div key={item.module} className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div><h3 className="text-sm font-medium">{item.label}</h3><p className="mt-1 text-sm text-muted-foreground">{moduleState(status, item)}</p></div>
              <Button variant="outline" disabled={!available || Boolean(busy)} onClick={() => void connect(item.module)} className="self-start sm:self-auto">
                {busy === item.module ? 'Abrindo Google…' : action}
              </Button>
            </div>;
          })}
        </section>
        <p className="text-xs text-muted-foreground">Drive e Docs usam a mesma permissão do Google; ao autorizar um, o outro também pode aparecer como conectado. Sair do Lume encerra sua sessão, mas a sincronização continua.</p>
        {status.connection && <div className="border-t pt-6"><Button variant="outline" disabled={Boolean(busy)} onClick={() => setDisconnect(true)}>Desconectar conta Google</Button>
          <p className="mt-2 text-xs text-muted-foreground">A desconexão encerra o acesso de todas as integrações. Cópias já importadas permanecem no Cofre.</p>
        </div>}
      </div>
      {role === 'administrator' && <div id="integrations-panel-policy" role="tabpanel" aria-labelledby="integrations-tab-policy" hidden={tab !== 'policy'}>
        {!policy ? <p role="status" className="text-sm text-muted-foreground">Carregando regras…</p> : <section aria-labelledby="google-rules" className="space-y-5">
          <div><h2 id="google-rules" className="text-lg font-medium">Regras do escritório</h2><p className="mt-1 text-sm text-muted-foreground">Valem para interface e Lume. Ações automáticas acima dos limites pedem confirmação. Bloqueios sempre prevalecem.</p></div>
          <fieldset className="flex flex-wrap gap-5" disabled={Boolean(busy)}><legend className="mb-2 text-sm font-medium">Recursos permitidos</legend>{status.modules.map(item => <label key={item.module} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={policy.rules.modules[item.module]} onChange={event => { const checked = event.target.checked; setPolicy(previous => previous ? { ...previous, rules: { ...previous.rules, modules: { ...previous.rules.modules, [item.module]: checked } } } : previous); }}/>{item.label}</label>)}</fieldset>
          <div className="divide-y">{policy.actions.map(item => { const rule = policy.rules.actions[item.action]; return <fieldset key={item.action} disabled={Boolean(busy)} className="grid gap-3 py-5 md:grid-cols-[minmax(180px,1fr)_2fr]"><legend className="sr-only">{item.label}</legend><label className="text-sm font-medium" htmlFor={`mode-${item.action}`}>{item.label}</label><div className="space-y-3"><select className={selectStyle} id={`mode-${item.action}`} value={rule.mode} onChange={event => updateRule(item.action, 'mode', event.target.value)}><option value="blocked">Bloqueada</option><option value="confirmation">Exige confirmação</option><option value="automatic">Automática dentro dos limites</option></select>{rule.mode === 'automatic' && <div className="grid gap-3 sm:grid-cols-2">{item.limits.map(limit => { const value = rule[limit as keyof typeof rule]; return <label key={limit} className="space-y-1 text-xs">{limits[limit]}<Input type="number" min={limit === 'maxRecipients' ? 1 : 0} step={limit === 'maxAttachmentBytes' ? '0.1' : '1'} value={value === null ? '' : Number(value) / (limit === 'maxAttachmentBytes' ? 1024 * 1024 : 1)} placeholder="Limite técnico" onChange={event => updateRule(item.action, limit, event.target.value)} /></label>; })}</div>}</div></fieldset>; })}</div>
          <div className="flex flex-wrap items-center gap-3"><Button disabled={Boolean(busy)} onClick={() => void perform('policy', async () => { const saved = await googleCall<Policy>('policy-save', { version: policy.version, rules: policy.rules }); setPolicy(saved); await refresh(); setNotice('Regras salvas.'); })}>{busy === 'policy' ? 'Salvando…' : 'Salvar regras'}</Button><p className="text-xs text-muted-foreground">Versão {policy.version} · Máximo técnico: 500 ações/dia, 100 destinatários, 10 anexos e 25 MB.</p></div>
        </section>}
      </div>}
    </>}
    <Dialog open={disconnect} onOpenChange={setDisconnect}><DialogContent><DialogHeader><DialogTitle>Desconectar a conta Google?</DialogTitle><DialogDescription>O Lume interromperá a sincronização e revogará o acesso a todas as integrações. Os arquivos já importados permanecem no Cofre.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={Boolean(busy)} onClick={() => setDisconnect(false)}>Cancelar</Button><Button disabled={Boolean(busy)} onClick={() => void perform('disconnect', async () => { const response = await fetch('/api/integrations/google/disconnect', { method: 'POST' }); if (!response.ok) throw new Error((await response.json()).error); setDisconnect(false); await refresh(); setNotice('Conta desconectada.'); })}>{busy === 'disconnect' ? 'Desconectando…' : 'Desconectar'}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
