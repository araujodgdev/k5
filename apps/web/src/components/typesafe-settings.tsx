'use client';

import { useId, useState } from 'react';
import { CircleAlert, Info } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { DataTable, Field } from './canvas/canvas-controls';
import { AdminBlock, AdminBlockHead, AdminFields, AdminNote, adminButton, adminInput, adminQuietAction, adminSelect } from './admin/admin-blocks';
import type { ConnectionView, DecisionMode } from '@/lib/typesafe/contracts';

const areas = [['rag', 'Cofre e busca'], ['documents', 'Documentos'], ['agenda', 'Agenda'], ['research', 'Pesquisa'], ['feedback', 'Triagem de feedback'], ['email', 'Classificação de e-mails']] as const;
type Area = (typeof areas)[number];
type Notice = { tone: 'status' | 'alert'; text: string };

/** The platform's single TypeSafe connection: its key and budget, and what each area does with it. */
export function TypesafeSettings({ initial }: { initial: ConnectionView }) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  async function submit(method: 'PUT' | 'POST' | 'DELETE') {
    setBusy(true); setNotice(null);
    try {
      const response = await fetch('/api/platform/typesafe', {
        method, headers: { 'content-type': 'application/json' },
        ...(method === 'PUT' ? { body: JSON.stringify({ ...value, apiKey: key || undefined }) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível validar a conexão. Confira a chave, a ativação e o orçamento.');
      if (data.connection) { setValue(data.connection); setKey(''); }
      setNotice({ tone: 'status', text: method === 'POST' ? 'Conexão validada com conteúdo de teste.' : method === 'DELETE' ? 'Credencial removida.' : 'Configuração salva.' });
    } catch (failure) { setNotice({ tone: 'alert', text: failure instanceof Error ? failure.message : 'Não foi possível salvar.' }); }
    finally { setBusy(false); }
  }
  return (
    <AdminBlock labelledBy={`${id}-title`}>
      <form aria-labelledby={`${id}-title`} className="contents" onSubmit={event => { event.preventDefault(); void submit('PUT'); }}>
        <AdminBlockHead id={`${id}-title`} title="TypeSafe" sub="Uma conexão para todos os escritórios." actions={<>
          <Button type="button" variant="outline" className={adminButton} disabled={busy || !value.enabled || !value.hasKey} onClick={() => void submit('POST')}>Testar conexão</Button>
          <Button type="submit" className={adminButton} disabled={busy}>Salvar TypeSafe</Button>
        </>} />
        <fieldset disabled={busy} className="contents">
          <AdminFields>
            <Field label="Chave da API" htmlFor={`${id}-key`} className="min-w-[140px] flex-[2_1_0]">
              <Input id={`${id}-key`} type="password" autoComplete="new-password" className={adminInput} value={key} onChange={event => setKey(event.target.value)}
                required={!value.hasKey} placeholder={value.hasKey ? `Atual: ${value.keyHint}. Deixe em branco para manter.` : 'Cole a chave'} />
            </Field>
            <Field label="Versão do modelo" htmlFor={`${id}-model`} className="min-w-[140px] flex-[1_1_0]">
              <Input id={`${id}-model`} className={`${adminInput} font-mono`} value={value.model} onChange={event => setValue({ ...value, model: event.target.value })} pattern="jev-[0-9]+\.[0-9]+\.[0-9]+" required />
            </Field>
            <Field label="Reserva diária de tokens (todos os escritórios)" htmlFor={`${id}-budget`} className="min-w-[140px] flex-[1_1_0]">
              <Input id={`${id}-budget`} type="number" className={`${adminInput} font-mono`} min={1000} max={10000000} required value={value.dailyTokens} onChange={event => setValue({ ...value, dailyTokens: Number(event.target.value) })} />
            </Field>
            <Field label="Chamadas simultâneas" htmlFor={`${id}-concurrency`} className="min-w-[140px] flex-[1_1_0]">
              <Input id={`${id}-concurrency`} type="number" className={`${adminInput} font-mono`} min={1} max={8} required value={value.concurrency} onChange={event => setValue({ ...value, concurrency: Number(event.target.value) })} />
            </Field>
          </AdminFields>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex min-h-11 items-center gap-2 text-[13.5px] md:min-h-0">
              <input type="checkbox" className="size-4 accent-foreground" checked={value.enabled} onChange={event => setValue({ ...value, enabled: event.target.checked })} />Conexão ativa
            </label>
            {value.hasKey && <button type="button" className={adminQuietAction} onClick={() => void submit('DELETE')}>Remover credencial</button>}
          </div>
          <DataTable<Area> label="Modo do TypeSafe por área" rows={areas} rowKey={([name]) => name} columns={[
            { header: 'Área', width: 'minmax(0, 1fr)', cell: ([, label]) => label },
            { header: 'Modo', width: '180px', cell: ([name, label]) => (
              <select aria-label={`Modo em ${label}`} className={`${adminSelect} px-2`} value={value[name]} onChange={event => setValue({ ...value, [name]: event.target.value as DecisionMode })}>
                <option value="off">Desligado</option><option value="shadow">Avaliar sem aplicar</option><option value="enabled">Ativado</option>
              </select>
            ) },
          ]} />
        </fieldset>
        <AdminNote icon={Info}>Avaliar sem aplicar também envia dados ao TypeSafe e consome o orçamento. Ative depois de avaliar os resultados. O custo é da plataforma.</AdminNote>
        {busy && <p role="status" className="text-[12.5px] text-muted-foreground">Processando…</p>}
        {notice && (notice.tone === 'status'
          ? <p role="status" className="text-[12.5px] text-muted-foreground">{notice.text}</p>
          : <p role="alert" className="flex items-start gap-2 text-[13.5px] text-destructive"><CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />{notice.text}</p>)}
      </form>
    </AdminBlock>
  );
}
