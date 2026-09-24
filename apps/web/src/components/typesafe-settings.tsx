'use client';
import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import type { ConnectionView, DecisionMode } from '@/lib/typesafe/contracts';
export function TypesafeSettings({ initial }: { initial: ConnectionView }) {
  const [value, setValue] = useState(initial);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  async function submit(method: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/platform/typesafe', {
        method, headers: { 'content-type': 'application/json' },
        ...(method === 'PUT' ? { body: JSON.stringify({ ...value, apiKey: key || undefined }) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível validar a conexão. Confira a chave, a ativação e o orçamento.');
      if (data.connection) { setValue(data.connection); setKey(''); }
      setNotice(method === 'POST' ? 'Conexão validada com conteúdo de teste.' : method === 'DELETE' ? 'Credencial removida.' : 'Configuração salva.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  }
  return <section className="mt-6" aria-label="Configuração do TypeSafe">
    <p className="max-w-3xl text-sm text-muted-foreground">Uma única conexão atende todos os escritórios: relevância de fontes, verificação documental, sugestões de agenda, comparação de julgados e triagem de feedback. O custo é da plataforma.</p>
    <form className="mt-5 grid gap-4" onSubmit={event => { event.preventDefault(); void submit('PUT'); }}>
      <fieldset disabled={busy} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-1.5"><Label htmlFor="typesafe-key">Chave da API</Label><Input id="typesafe-key" type="password" autoComplete="new-password" className="h-11 md:h-9" value={key} onChange={event => setKey(event.target.value)} required={!value.hasKey} placeholder={value.hasKey ? `Atual: ${value.keyHint}. Deixe em branco para manter.` : 'Cole a chave'} /></div>
          <div className="grid gap-1.5"><Label htmlFor="typesafe-model">Versão do modelo</Label><Input id="typesafe-model" value={value.model} onChange={event => setValue({ ...value, model: event.target.value })} pattern="jev-[0-9]+\.[0-9]+\.[0-9]+" required className="h-11 md:h-9" /></div></div>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={value.enabled} onChange={event => setValue({ ...value, enabled: event.target.checked })} />Conexão ativa</label>
        <div className="grid gap-4 sm:grid-cols-2">{([['rag', 'Cofre e busca'], ['documents', 'Documentos'], ['agenda', 'Agenda'], ['research', 'Pesquisa'], ['feedback', 'Triagem de feedback'], ['email', 'Classificação de e-mails']] as const).map(([name, label]) => <div key={name} className="grid gap-1.5"><Label htmlFor={`typesafe-${name}`}>{label}</Label><select id={`typesafe-${name}`} className="h-11 w-full rounded-md border bg-background px-3 text-sm md:h-9" value={value[name]} onChange={event => setValue({ ...value, [name]: event.target.value as DecisionMode })}><option value="off">Desligado</option><option value="shadow">Avaliar sem aplicar</option><option value="enabled">Ativado</option></select></div>)}</div>
        <p className="text-xs text-muted-foreground">Avaliar sem aplicar também envia dados ao TypeSafe e consome o orçamento. Ative após avaliar os resultados.</p>
        <div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-1.5"><Label htmlFor="typesafe-budget">Reserva diária de tokens (todos os escritórios)</Label><Input id="typesafe-budget" type="number" min={1000} max={10000000} required value={value.dailyTokens} onChange={event => setValue({ ...value, dailyTokens: Number(event.target.value) })} /></div><div className="grid gap-1.5"><Label htmlFor="typesafe-concurrency">Chamadas simultâneas</Label><Input id="typesafe-concurrency" type="number" min={1} max={8} required value={value.concurrency} onChange={event => setValue({ ...value, concurrency: Number(event.target.value) })} /></div></div>
        <div className="flex flex-wrap gap-2"><Button type="submit">Salvar TypeSafe</Button><Button type="button" variant="outline" disabled={!value.enabled || !value.hasKey} onClick={() => void submit('POST')}>Testar conexão</Button><Button type="button" variant="ghost" disabled={!value.hasKey} onClick={() => void submit('DELETE')}>Remover credencial</Button></div>
      </fieldset>
      {busy && <p role="status" className="text-sm text-muted-foreground">Processando…</p>}{notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  </section>;
}
