'use client';

import Link from 'next/link';
import { useLumeWorkspace } from '@/components/lume/workspace-context';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { selectStyle } from '@/lib/agenda-client';
import { caseTaskFields, type CaseTask } from '@/lib/case-tasks/contracts';
import type { CaseActivity } from '@/lib/case-collaboration';
import type { z } from 'zod';

async function call<T>(url: string, input?: unknown, method = 'POST', signal?: AbortSignal): Promise<T> {
  const response = await fetch(url,{ method:input === undefined ? 'GET' : method, signal,
    ...(input === undefined ? {} : { headers:{'content-type':'application/json'},body:JSON.stringify(input) }) });
  const result = await response.json().catch(()=>null);
  if (!response.ok) throw new Error(result?.error ?? 'Não foi possível concluir. Tente novamente.');
  return result as T;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível conectar. Tente novamente.';
const states: Record<CaseTask['status'],string> = { pending:'Pendente',in_progress:'Em andamento',completed:'Concluída',cancelled:'Cancelada' };
const money = (cents: number) => (cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

function useCaseData<T>(url: string) {
  const [data,setData]=useState<T|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[loadedUrl,setLoadedUrl]=useState('');
  const sequence=useRef(0);
  const load=useCallback(async(signal?:AbortSignal)=>{
    const operation=++sequence.current;
    try { const result=await call<T>(url,undefined,'GET',signal); if(!signal?.aborted && operation===sequence.current){setData(result);setError('');} }
    catch(error){if(!signal?.aborted && operation===sequence.current)setError(message(error));}
    finally{if(!signal?.aborted && operation===sequence.current){setLoading(false);setLoadedUrl(url);}}
  },[url]);
  useEffect(()=>{const controller=new AbortController();queueMicrotask(()=>{if(!controller.signal.aborted)void load(controller.signal);});return()=>controller.abort();},[load]);
  return {data:loadedUrl===url ? data : null,error:loadedUrl===url ? error : '',loading:loading || loadedUrl!==url,load,setData};
}
function Failure({error,retry}:{error:string;retry:()=>void}) {
  return error ? <div className="flex flex-wrap items-center gap-3 py-3"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={retry}>Tentar novamente</Button></div> : null;
}

export function CaseLumePolicy({caseId}:{caseId:string}) {
  const {data,error,loading,load,setData}=useCaseData<{enabled:boolean;canManage:boolean}>(`/api/cases/${caseId}/policy`);
  const [saving,setSaving]=useState(false),[failure,setFailure]=useState('');
  async function toggle(enabled:boolean) {
    setSaving(true);setFailure('');
    try{setData(await call(`/api/cases/${caseId}/policy`,{enabled},'PUT'));}
    catch(error){setFailure(message(error));}finally{setSaving(false);}
  }
  return <section aria-label="Permissão do Lume" className="border-b py-5">
    {loading && <p role="status" className="text-sm">Carregando permissão do Lume…</p>}
    <Failure error={error} retry={()=>void load()} />
    {data && <><label className="flex min-h-11 items-center gap-3 font-medium"><input type="checkbox" className="size-5 accent-foreground" checked={data.enabled} disabled={!data.canManage || saving} onChange={event=>void toggle(event.target.checked)} />O Lume pode trabalhar neste caso</label>
      <p className="mt-1 text-sm text-muted-foreground">Ele lê e edita com as permissões de quem pede. Envios para fora sempre pedem confirmação.</p>
      {!data.canManage && <p className="mt-2 text-sm text-muted-foreground">Só o dono do caso altera esta permissão.</p>}
      {saving && <p role="status" className="mt-2 text-sm">Salvando permissão…</p>}
    </>}
    {failure && <p role="alert" className="mt-2 text-sm text-destructive">{failure}</p>}
  </section>;
}

type Draft = z.output<typeof caseTaskFields>;
const empty: Draft = {title:'',notes:'',status:'pending',dueOn:null,assigneeId:null};
export function CaseTasks({caseId,selectedTask}:{caseId:string;selectedTask?:string}) {
  const { navigate } = useLumeWorkspace();
  const {data,error,loading,load}=useCaseData<{tasks:CaseTask[];members:{id:string;name:string}[]}>(`/api/cases/${caseId}/tasks`);
  const [editing,setEditing]=useState<{id:string;version:number}|'new'|null>(null),[draft,setDraft]=useState<Draft>(empty);
  const [failure,setFailure]=useState(''),[busy,setBusy]=useState(false),[archived,setArchived]=useState(false);
  const creationKey=useRef(''),fields=useRef<HTMLFormElement>(null);
  function open(task?:CaseTask) {
    setFailure('');setEditing(task ? {id:task.id,version:task.version} : 'new');
    setDraft(task ? caseTaskFields.parse(task) : {...empty});creationKey.current=crypto.randomUUID();
    requestAnimationFrame(()=>fields.current?.querySelector<HTMLInputElement>('input')?.focus());
  }
  async function save(event:FormEvent) {
    event.preventDefault();if(busy || !editing)return;setBusy(true);setFailure('');
    try {
      const values=caseTaskFields.parse(draft);
      await call(editing==='new' ? `/api/cases/${caseId}/tasks` : `/api/cases/${caseId}/tasks/${editing.id}`,
        {...values,...(editing==='new' ? {idempotencyKey:creationKey.current} : {version:editing.version})},editing==='new' ? 'POST' : 'PUT');
      setEditing(null);await load();
    } catch(error) {setFailure(message(error));} finally{setBusy(false);}
  }
  async function complete(task:CaseTask) {
    setBusy(true);setFailure('');
    try{await call(`/api/cases/${caseId}/tasks/${task.id}`,{...caseTaskFields.parse(task),status:'completed',version:task.version},'PUT');await load();}
    catch(error){setFailure(message(error));}finally{setBusy(false);}
  }
  async function delegate(task:CaseTask) {
    setBusy(true);setFailure('');
    try{const result=await call<{url:string}>('/api/agenda/delegate',{activityId:task.id,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});await load();await navigate(result.url);}
    catch(error){setFailure(message(error));}finally{setBusy(false);}
  }
  async function refreshVersion() {
    if(!editing || editing==='new')return;setBusy(true);
    try{const {task}=await call<{task:CaseTask}>(`/api/cases/${caseId}/tasks/${editing.id}`);setEditing({id:task.id,version:task.version});setFailure('');await load();}
    catch(error){setFailure(message(error));}finally{setBusy(false);}
  }
  const visible=(data?.tasks ?? []).filter(task=>archived ? ['completed','cancelled'].includes(task.status) : ['pending','in_progress'].includes(task.status));
  return <section aria-label="Tarefas compartilhadas" className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-medium">Tarefas</h2><Button onClick={()=>open()} disabled={busy}>Nova tarefa</Button></div>
    <p className="mt-2 text-sm text-muted-foreground">Todos do caso podem colaborar. Conversas com o Lume ficam particulares.</p>
    <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Lista de tarefas"><Button variant="outline" aria-pressed={!archived} onClick={()=>setArchived(false)}>Abertas</Button><Button variant="outline" aria-pressed={archived} onClick={()=>setArchived(true)}>Arquivadas</Button><Button variant="ghost" onClick={()=>void load()}>Atualizar tarefas</Button></div>
    {loading && <p role="status" className="py-4 text-sm">Carregando tarefas…</p>}
    <Failure error={error} retry={()=>void load()} />
    {failure && <p role="alert" className="py-3 text-sm text-destructive">{failure}</p>}
    {editing && <form aria-label="Editar tarefa compartilhada" onSubmit={save} className="mt-4 grid gap-4 border-y py-5" ref={fields}>
      <div className="grid gap-1.5"><Label htmlFor="case-task-title">Título da tarefa</Label><Input id="case-task-title" required minLength={2} maxLength={180} value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})} /></div>
      <div className="grid gap-1.5"><Label htmlFor="case-task-notes">Descrição da tarefa</Label><Textarea id="case-task-notes" maxLength={4000} value={draft.notes} onChange={event=>setDraft({...draft,notes:event.target.value})} /></div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5"><Label htmlFor="case-task-assignee">Responsável</Label><select id="case-task-assignee" className={selectStyle} value={draft.assigneeId ?? ''} onChange={event=>setDraft({...draft,assigneeId:event.target.value || null})}><option value="">Sem responsável</option>{data?.members.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}{draft.assigneeId && !data?.members.some(member=>member.id===draft.assigneeId) && <option value={draft.assigneeId}>Acesso removido</option>}</select></div>
        <div className="grid gap-1.5"><Label htmlFor="case-task-due">Prazo</Label><Input id="case-task-due" type="date" value={draft.dueOn ?? ''} onChange={event=>setDraft({...draft,dueOn:event.target.value || null})} /></div>
        <div className="grid gap-1.5"><Label htmlFor="case-task-status">Estado</Label><select id="case-task-status" className={selectStyle} value={draft.status} onChange={event=>setDraft({...draft,status:event.target.value as Draft['status']})}>{Object.entries(states).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
      </div>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || draft.title.trim().length<2}>{busy ? 'Salvando…' : 'Salvar tarefa'}</Button><Button type="button" variant="ghost" disabled={busy} onClick={()=>setEditing(null)}>Cancelar edição</Button>{failure && editing!=='new' && <Button type="button" variant="outline" disabled={busy} onClick={()=>void refreshVersion()}>Atualizar versão e manter rascunho</Button>}</div>
    </form>}
    {!loading && !error && !visible.length && <p className="py-5 text-sm text-muted-foreground">{archived ? 'Nenhuma tarefa arquivada neste caso.' : 'Nenhuma tarefa aberta neste caso.'}</p>}
    <div className="mt-3">{visible.map(task=><article key={task.id} aria-label={task.title} className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b py-4" data-selected={selectedTask===task.id || undefined}>
      <div className="min-w-0 flex-1 basis-48"><h3 className="font-medium break-words">{task.title}</h3><p className="mt-1 text-sm text-muted-foreground">{states[task.status]} · {data?.members.find(member=>member.id===task.assigneeId)?.name ?? (task.assigneeId ? 'Acesso removido' : 'Sem responsável')}{task.dueOn ? ' · '+task.dueOn.split('-').reverse().join('/') : ''}</p>{task.notes && <p className="mt-2 whitespace-pre-wrap text-sm break-words">{task.notes}</p>}</div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={()=>open(task)}>Editar tarefa</Button>{!archived && <Button variant="outline" disabled={busy} onClick={()=>void complete(task)}>Concluir</Button>}{task.agentConversationId ? <Button variant="outline" asChild><Link href={`/app/agents?conversationId=${encodeURIComponent(task.agentConversationId)}&caseId=${encodeURIComponent(caseId)}`}>Minha conversa</Link></Button> : !archived && <Button variant="outline" disabled={busy} onClick={()=>void delegate(task)}>Pedir ao Lume</Button>}</div>
    </article>)}</div>
  </section>;
}

type FeeProjection = { total:number;summary:{totalCents:number;receivedCents:number;pendingCents:number};installments:{id:string;agreementId:string;title:string;number:number;installmentCount:number;dueOn:string;amountCents:number;receivedCents:number;pendingCents:number;status:string;canManage:boolean}[] };
export function CaseHonorarios({caseId}:{caseId:string}) {
  const [view,setView]=useState('pending'),[offset,setOffset]=useState(0);
  const {data,error,loading,load}=useCaseData<FeeProjection>(`/api/cases/${caseId}/honorarios?view=${view}&offset=${offset}`);
  const feeStates:Record<string,string>={pending:'Pendente',partial:'Recebido em parte',received:'Recebido',cancelled:'Cancelado'};
  return <section aria-label="Honorários do caso" className="min-w-0"><div className="flex flex-wrap justify-between gap-3"><h2 className="text-2xl font-medium">Honorários</h2><Button variant="outline" asChild><Link href={`/app/honorarios?caseId=${encodeURIComponent(caseId)}`}>Abrir Honorários</Link></Button></div>
    <p className="mt-2 text-sm text-muted-foreground">Os participantes consultam os valores. Só quem criou gerencia os honorários.</p>
    <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Estado dos honorários">{[['pending','Pendentes'],['received','Recebidos'],['cancelled','Cancelados']].map(([value,label])=><Button key={value} variant="outline" aria-pressed={view===value} onClick={()=>{setView(value);setOffset(0);}}>{label}</Button>)}</div>
    {loading && <p role="status" className="py-4 text-sm">Carregando honorários…</p>}<Failure error={error} retry={()=>void load()} />
    {data && <><p className="py-4 text-sm">Total {money(data.summary.totalCents)} · Recebido {money(data.summary.receivedCents)} · Pendente {money(data.summary.pendingCents)}</p>
      {!data.installments.length && <p className="py-4 text-sm text-muted-foreground">Nenhum honorário neste estado para o caso.</p>}
      {data.installments.map(row=><div key={row.id} className="flex flex-wrap justify-between gap-3 border-b py-4"><div className="min-w-0"><p className="font-medium break-words">{row.title}</p><p className="mt-1 text-sm text-muted-foreground">Parcela {row.number} de {row.installmentCount} · {row.dueOn.split('-').reverse().join('/')} · {feeStates[row.status]}</p><p className="mt-1 text-sm">{money(row.amountCents)} · Saldo {money(row.pendingCents)}</p></div><Button variant="outline" asChild><Link href={`/app/honorarios?agreementId=${encodeURIComponent(row.agreementId)}`}>{row.canManage ? 'Gerenciar honorário' : 'Consultar honorário'}</Link></Button></div>)}
      <div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>Anteriores</Button><Button variant="outline" disabled={offset+50>=data.total} onClick={()=>setOffset(offset+50)}>Próximos</Button></div>
    </>}
  </section>;
}
export function CaseRecentActivity({caseId}:{caseId:string}) {
  const {data,error,loading,load}=useCaseData<{activity:CaseActivity[]}>(`/api/cases/${caseId}/activity`);
  return <section aria-label="Atividade do caso"><div className="flex flex-wrap justify-between gap-3"><h2 className="text-2xl font-medium">Atividade</h2><Button variant="outline" onClick={()=>void load()}>Atualizar atividade</Button></div>
    <p className="mt-2 text-sm text-muted-foreground">Versões de páginas, acessos, arquivos e tarefas disponíveis para você. As tarefas mostram criação e estado atual.</p>
    {loading && <p role="status" className="py-4 text-sm">Carregando atividade…</p>}<Failure error={error} retry={()=>void load()} />
    {data && !data.activity.length && <p className="py-5 text-sm text-muted-foreground">Nenhuma atividade disponível neste caso.</p>}
    {data?.activity.map(item=><Link key={item.id} href={item.href} className="flex min-h-11 flex-wrap justify-between gap-3 border-b py-4 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0 flex-1 basis-48"><span className="block font-medium break-words">{item.title}</span><span className="mt-1 block text-sm text-muted-foreground">{item.actor ? item.actor+' · ' : ''}{item.detail}</span></span><time dateTime={item.at} className="font-mono text-xs text-muted-foreground">{new Date(item.at).toLocaleString('pt-BR')}</time></Link>)}
  </section>;
}
