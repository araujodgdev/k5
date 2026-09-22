'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { requestCapability } from '@/lib/capabilities/http-client';
import type { ResearchCaseAssessment, ResearchCaseReference } from '@/lib/application/research-case-service';
import { AssessmentView } from './research-case-linker';
import { ResearchDraftStarter } from './research-draft-starter';

const purposeLabels = { foundation: 'Fundamentação', counterpoint: 'Contraponto', context: 'Contexto' } as const;
const formatDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
function dateLabel(value: string) {
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? value : formatDate.format(date);
}
function outcome<T>(result: Awaited<ReturnType<typeof requestCapability>>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data as T;
}

export function ResearchCaseReferences({ caseId, canWrite }: { caseId: string; canWrite: boolean }) {
  const [references, setReferences] = useState<ResearchCaseReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const load = async () => {
      const response = await requestCapability('k5_research_list_references', { caseId });
      if (!live) return;
      if (response.ok) setReferences((response.data as { references: ResearchCaseReference[] }).references);
      else setError(response.error);
      setLoading(false);
    };
    void load();
    return () => { live = false; };
  }, [caseId]);
  const replace = (next: ResearchCaseReference) => setReferences(current => current.map(item => item.id === next.id ? next : item));
  const remove = (id: string) => setReferences(current => current.filter(item => item.id !== id));
  return <section aria-label="Referências do caso">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3"><h2 className="text-base font-medium">Referências</h2><div className="flex flex-wrap gap-2">{canWrite && <ResearchDraftStarter caseId={caseId} references={references} />}<Button asChild variant="outline" className="min-h-11 md:min-h-9"><Link href="/app/research">Pesquisar julgados</Link></Button></div></div>
    {loading && <p className="py-8 text-sm text-muted-foreground">Carregando referências…</p>}
    {error && <p role="alert" className="flex gap-2 py-4 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
    {!loading && !error && references.length === 0 && <p className="py-8 text-sm text-subtle-foreground">Nenhum julgado vinculado a este caso.</p>}
    {references.map(reference => <ReferenceRow key={reference.id} reference={reference} canWrite={canWrite} onChange={replace} onRemove={remove} />)}
  </section>;
}

function ReferenceRow({ reference, canWrite, onChange, onRemove }: {
  reference: ResearchCaseReference; canWrite: boolean;
  onChange: (reference: ResearchCaseReference) => void; onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [purpose, setPurpose] = useState(reference.purpose);
  const [notes, setNotes] = useState(reference.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [upgradeAssessment, setUpgradeAssessment] = useState<ResearchCaseAssessment | null>(null);
  const material = reference.material;
  const newerVersion = material?.currentVersionId && material.currentVersionId !== reference.materialVersionId ? material.currentVersionId : null;
  useEffect(() => {
    if (!upgradeAssessment || !['queued', 'running'].includes(upgradeAssessment.status)) return;
    const id = upgradeAssessment.id;
    let cancelled = false;
    let running = false;
    const timer = window.setInterval(async () => {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      const response = await requestCapability('k5_research_get_assessment', { assessmentId: id });
      running = false;
      if (cancelled) return;
      if (response.ok) setUpgradeAssessment(current => current?.id === id ? (response.data as { assessment: ResearchCaseAssessment }).assessment : current);
      else { setError(response.error); setUpgradeAssessment(null); }
    }, 3500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [upgradeAssessment]);

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const next = outcome<{ reference: ResearchCaseReference }>(await requestCapability('k5_research_update_reference', {
        referenceId: reference.id, expectedVersion: reference.version, purpose, notes: notes.trim(), idempotencyKey: crypto.randomUUID(),
      })).reference;
      onChange(next); setEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a referência.'); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError('');
    try {
      outcome(await requestCapability('k5_research_remove_reference', { referenceId: reference.id, expectedVersion: reference.version, idempotencyKey: crypto.randomUUID() }));
      onRemove(reference.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível remover a referência.'); }
    finally { setBusy(false); }
  }
  async function assessNewVersion() {
    if (!newerVersion) return;
    setBusy(true); setError('');
    try {
      const next = outcome<{ assessment: ResearchCaseAssessment }>(await requestCapability('k5_research_assess_material', {
        caseId: reference.caseId, materialVersionId: newerVersion, idempotencyKey: crypto.randomUUID(),
      })).assessment;
      setUpgradeAssessment(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível avaliar a nova versão.'); }
    finally { setBusy(false); }
  }
  async function updateVersion(bypassEvaluation: boolean) {
    if (!newerVersion || !upgradeAssessment) return;
    setBusy(true); setError('');
    try {
      const next = outcome<{ reference: ResearchCaseReference }>(await requestCapability('k5_research_update_reference', {
        referenceId: reference.id, expectedVersion: reference.version, materialVersionId: newerVersion,
        assessmentId: upgradeAssessment.id, bypassEvaluation, idempotencyKey: crypto.randomUUID(),
      })).reference;
      onChange(next); setUpgradeAssessment(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar a versão.'); }
    finally { setBusy(false); }
  }

  return <article className="border-b py-5 text-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><Link href={material ? `/app/research/judgments/${encodeURIComponent(material.judgmentId)}` : '#'} className="font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{material?.title ?? 'Material indisponível'}</Link><p className="mt-1 text-[13px] text-muted-foreground">{material?.tribunal ?? 'Fonte indisponível'}{material?.caseNumber ? ` · ${material.caseNumber}` : ''} · {material?.kind === 'full_text' ? 'Inteiro teor' : 'Ementa'} · versão fixada em {dateLabel(reference.createdAt)}</p></div><span className="text-[13px] text-muted-foreground">{purposeLabels[reference.purpose]}</span></div>
    <p className="mt-2 text-[13px] text-muted-foreground">{reference.assessment?.current ? reference.assessment.status === 'evaluated' ? 'Avaliação atual' : 'Avaliação incompleta ou indisponível' : reference.assessment ? 'Avaliação desatualizada' : 'Sem avaliação'}{reference.bypassEvaluation ? ' · Adicionada sem avaliação' : ''}</p>
    {material && !material.localAllowed && <p className="mt-2 text-sm text-muted-foreground">A fonte restringiu o acesso a este material.</p>}
    {reference.notes && !editing && <p className="mt-3 whitespace-pre-wrap">{reference.notes}</p>}
    {reference.assessment && <details className="mt-3"><summary className="min-h-11 cursor-pointer text-sm text-muted-foreground">Ver avaliação</summary><AssessmentView assessment={reference.assessment} hasThesis /></details>}
    {error && <p role="alert" className="mt-3 flex gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
    {canWrite && <div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="ghost" className="min-h-11 md:min-h-9" aria-expanded={editing} onClick={() => setEditing(value => !value)}>{editing ? 'Fechar edição' : 'Editar anotação e finalidade'}</Button><AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="ghost" className="min-h-11 md:min-h-9" disabled={busy}>Remover vínculo</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remover esta referência?</AlertDialogTitle><AlertDialogDescription>O julgado continua no acervo. A versão já usada em minutas permanece no histórico delas.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void remove()}>Remover</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>}
    {editing && canWrite && <form onSubmit={save} className="mt-3 grid gap-4"><div className="grid gap-1.5"><Label htmlFor={`purpose-${reference.id}`}>Finalidade</Label><select id={`purpose-${reference.id}`} className="h-11 rounded-md border bg-background px-3 text-sm md:h-9" value={purpose} onChange={event => setPurpose(event.target.value as ResearchCaseReference['purpose'])}>{Object.entries(purposeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="grid gap-1.5"><Label htmlFor={`notes-${reference.id}`}>Anotação privada</Label><Textarea id={`notes-${reference.id}`} value={notes} onChange={event => setNotes(event.target.value)} maxLength={4000} className="min-h-20" /></div><Button type="submit" disabled={busy} className="min-h-11 justify-self-start md:min-h-9">Salvar referência</Button></form>}
    {canWrite && newerVersion && material?.localAllowed && <div className="mt-4 border-t pt-4"><p className="text-sm">Há uma nova versão deste material na fonte.</p><Button type="button" variant="outline" className="mt-2 min-h-11 md:min-h-9" disabled={busy} onClick={() => void assessNewVersion()}>Avaliar nova versão</Button>{upgradeAssessment && <div className="mt-3"><AssessmentView assessment={upgradeAssessment} hasThesis /><div className="mt-3 flex flex-wrap gap-2">{upgradeAssessment.current && upgradeAssessment.status === 'evaluated' && <Button type="button" disabled={busy} onClick={() => void updateVersion(false)} className="min-h-11 md:min-h-9">Atualizar versão</Button>}{upgradeAssessment.current && !['queued', 'running', 'stale', 'evaluated'].includes(upgradeAssessment.status) && <Button type="button" variant="outline" disabled={busy} onClick={() => void updateVersion(true)} className="min-h-11 md:min-h-9">Atualizar sem avaliação</Button>}</div></div>}</div>}
  </article>;
}
