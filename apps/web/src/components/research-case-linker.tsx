'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { CircleAlert, LoaderCircle, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { requestCapability } from '@/lib/capabilities/http-client';
import type { JudgmentDetail } from '@/lib/research/contracts';
import type { ResearchCaseProfile, ResearchCaseAssessment, ResearchCaseReference } from '@/lib/application/research-case-service';

type Case = { id: string; name: string };
type Document = { id: string; name: string; status: string };
type Fact = { text: string; documentIds: string[]; chunkIds: string[] };
type Draft = { legalQuestion: string; objective: string; thesis: string; documentedFacts: Fact[]; allegedFacts: string[]; gaps: string[] };
const emptyDraft = (): Draft => ({ legalQuestion: '', objective: '', thesis: '', documentedFacts: [], allegedFacts: [], gaps: [] });
const fromProfile = (profile: ResearchCaseProfile | null): Draft => profile ? {
  legalQuestion: profile.legalQuestion, objective: profile.objective, thesis: profile.thesis ?? '',
  documentedFacts: profile.documentedFacts.map(fact => ({ ...fact, chunkIds: fact.chunkIds ?? [] })),
  allegedFacts: profile.allegedFacts, gaps: profile.gaps,
} : emptyDraft();
function outcome<T>(result: Awaited<ReturnType<typeof requestCapability>>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data as T;
}
const purposeLabels = { foundation: 'Fundamentação', counterpoint: 'Contraponto', context: 'Contexto' } as const;
const scoreLabels = {
  legal: ['Sem relação', 'Tema amplo', 'Questão parcialmente relacionada', 'Mesma questão com diferenças', 'Mesma questão diretamente examinada'],
  factual: ['Fatos incompatíveis', 'Só características genéricas', 'Algumas circunstâncias comuns', 'Fatos decisivos em grande parte comuns', 'Fatos decisivos comparáveis'],
  procedural: ['Objeto incompatível', 'Relação remota', 'Aplicação condicionada', 'Contexto bastante próximo', 'Pedido e questão comparáveis'],
} as const;
const stanceLabels: Record<string, string> = { supports: 'Apoia a tese', opposes: 'Contraria a tese', mixed: 'Relação mista', unrelated: 'Não enfrenta a tese', insufficient: 'Informação insuficiente' };
const adequacyLabels: Record<string, string> = { adequate: 'Adequada', partial: 'Parcial', insufficient: 'Insuficiente' };
// Presentation threshold only: model confidence is not a calibrated chance of legal success.
const confidenceText = (value: number) => `Confiança do modelo ${Math.round(value * 100)}%${value < 0.6 ? ' · baixa' : ''}`;

export function ResearchCaseLinker({ judgment }: { judgment: JudgmentDetail }) {
  const [open, setOpen] = useState(false);
  const [cases, setCases] = useState<Case[]>([]);
  const [caseId, setCaseId] = useState('');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [profile, setProfile] = useState<ResearchCaseProfile | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [materialVersionId, setMaterialVersionId] = useState(judgment.fullTextVersionId ?? judgment.ementaVersionId ?? '');
  const [assessment, setAssessment] = useState<ResearchCaseAssessment | null>(null);
  const [references, setReferences] = useState<ResearchCaseReference[]>([]);
  const [purpose, setPurpose] = useState<keyof typeof purposeLabels>('foundation');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [profileReviewed, setProfileReviewed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      const response = await requestCapability('k5_vault_list_cases', {});
      if (cancelled) return;
      if (response.ok) setCases((response.data as { cases: Case[] }).cases);
      else setError(response.error);
    };
    void load();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!caseId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true); setError(''); setNotice(''); setProfileReviewed(false); setAssessment(null);
      const [p, d, r] = await Promise.all([
        requestCapability('k5_research_get_profile', { caseId }),
        requestCapability('k5_vault_list_documents', { caseId, scope: 'case', limit: 50 }),
        requestCapability('k5_research_list_references', { caseId }),
      ]);
      if (cancelled) return;
      if (p.ok) { const next = (p.data as { profile: ResearchCaseProfile | null }).profile; setProfile(next); setDraft(fromProfile(next)); }
      else setError(p.error);
      if (d.ok) setDocuments((d.data as { documents: Document[] }).documents.filter(item => item.status === 'ready'));
      else setError(d.error);
      if (r.ok) setReferences((r.data as { references: ResearchCaseReference[] }).references);
      else setError(r.error);
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [caseId]);

  useEffect(() => {
    if (!open || !assessment || !['queued', 'running'].includes(assessment.status)) return;
    const id = assessment.id;
    let cancelled = false;
    let running = false;
    const timer = window.setInterval(async () => {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      const response = await requestCapability('k5_research_get_assessment', { assessmentId: id });
      running = false;
      if (cancelled) return;
      if (response.ok) setAssessment(current => current?.id === id ? (response.data as { assessment: ResearchCaseAssessment }).assessment : current);
      else { setError(response.error); setAssessment(null); }
    }, 3500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [open, assessment]);

  const linked = references.find(item => item.materialVersionId === materialVersionId);
  const canAssess = !!caseId && !!materialVersionId && profileReviewed;
  const incompleteProfile = !draft.legalQuestion.trim() || !draft.objective.trim() ||
    (!draft.documentedFacts.some(fact => fact.text.trim()) && !draft.allegedFacts.some(fact => fact.trim()));

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!caseId || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (profile && JSON.stringify(draft) === JSON.stringify(fromProfile(profile))) {
        setProfileReviewed(true); setNotice('Perfil revisado. Peça a avaliação.'); return;
      }
      const facts = draft.documentedFacts.filter(fact => fact.text.trim()).map(fact => ({ text: fact.text.trim(), documentIds: fact.documentIds, chunkIds: fact.chunkIds }));
      if (facts.some(fact => !fact.documentIds.length)) throw new Error('Associe um arquivo a cada fato documentado.');
      const documentIds = [...new Set(facts.flatMap(fact => fact.documentIds))];
      const next = outcome<{ profile: ResearchCaseProfile }>(await requestCapability('k5_research_save_profile', {
        caseId, expectedVersion: profile?.version ?? 0, legalQuestion: draft.legalQuestion.trim(), objective: draft.objective.trim(),
        thesis: draft.thesis.trim() || null, documentedFacts: facts,
        allegedFacts: draft.allegedFacts.map(value => value.trim()).filter(Boolean),
        gaps: draft.gaps.map(value => value.trim()).filter(Boolean), documentIds,
        idempotencyKey: crypto.randomUUID(),
      })).profile;
      setProfile(next); setDraft(fromProfile(next)); setProfileReviewed(true); setAssessment(null);
      setNotice('Perfil salvo. Revise o material e peça a avaliação.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o perfil.'); }
    finally { setBusy(false); }
  }

  async function assess() {
    if (!canAssess || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = outcome<{ assessment: ResearchCaseAssessment }>(await requestCapability('k5_research_assess_material', { caseId, materialVersionId, idempotencyKey: crypto.randomUUID() })).assessment;
      setAssessment(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível avaliar.'); }
    finally { setBusy(false); }
  }

  async function link(bypassEvaluation: boolean) {
    if (!caseId || !assessment || !profileReviewed || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const reference = outcome<{ reference: ResearchCaseReference }>(await requestCapability('k5_research_add_reference', {
        caseId, materialVersionId, purpose, notes: notes.trim(), assessmentId: assessment.id,
        bypassEvaluation, idempotencyKey: crypto.randomUUID(),
      })).reference;
      setReferences(current => [reference, ...current.filter(item => item.id !== reference.id)]);
      setNotice('Referência adicionada ao caso.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível adicionar a referência.'); }
    finally { setBusy(false); }
  }

  return <><Button type="button" onClick={() => setOpen(true)} className="min-h-11 md:min-h-9">Adicionar ao caso</Button>
    <Sheet open={open} onOpenChange={setOpen}><SheetContent side="bottom" className="max-h-[min(92dvh,900px)] gap-0 overflow-y-auto p-0"><SheetTitle className="border-b px-5 py-4 text-base font-medium">Adicionar ao caso</SheetTitle>
      <div className="space-y-6 px-5 py-5">
        {error && <p role="alert" className="flex gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
        {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
        <section aria-label="Escolha do caso"><h3 className="mb-2 text-sm font-medium">Caso</h3>{cases.length === 0 && <p className="text-sm text-subtle-foreground">Nenhum caso encontrado no Cofre.</p>}<div className="max-h-36 overflow-y-auto">{cases.map(item => <button key={item.id} type="button" onClick={() => setCaseId(item.id)} aria-pressed={caseId === item.id} className="flex min-h-11 w-full items-center border-b px-1 text-left text-sm outline-none aria-pressed:font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">{item.name}</button>)}</div></section>
        {loading && <p className="text-sm text-muted-foreground">Carregando o caso…</p>}
        {caseId && !loading && <>
          <form onSubmit={saveProfile} className="space-y-4 border-t pt-5"><h3 className="text-sm font-medium">Perfil para comparação</h3><p className="text-sm text-muted-foreground">Revise os fatos deste caso antes de comparar com o julgado. Informações de outro processo não são fatos do cliente.</p>
            <div className="grid gap-1.5"><Label htmlFor="research-question">Questão jurídica</Label><Textarea id="research-question" value={draft.legalQuestion} onChange={event => { setDraft({ ...draft, legalQuestion: event.target.value }); setProfileReviewed(false); }} maxLength={1500} required className="min-h-20" /></div>
            <div className="grid gap-1.5"><Label htmlFor="research-objective">Objetivo do caso</Label><Textarea id="research-objective" value={draft.objective} onChange={event => { setDraft({ ...draft, objective: event.target.value }); setProfileReviewed(false); }} maxLength={1500} required className="min-h-20" /></div>
            <div className="grid gap-1.5"><Label htmlFor="research-thesis">Tese (opcional)</Label><Textarea id="research-thesis" value={draft.thesis} onChange={event => { setDraft({ ...draft, thesis: event.target.value }); setProfileReviewed(false); }} maxLength={1500} className="min-h-20" /></div>
            <FactRows title="Fatos documentados" values={draft.documentedFacts} documents={documents} onChange={values => { setDraft({ ...draft, documentedFacts: values }); setProfileReviewed(false); }} />
            <TextRows title="Fatos alegados" values={draft.allegedFacts} onChange={values => { setDraft({ ...draft, allegedFacts: values }); setProfileReviewed(false); }} />
            <TextRows title="Lacunas" values={draft.gaps} onChange={values => { setDraft({ ...draft, gaps: values }); setProfileReviewed(false); }} />
            <Button type="submit" variant="outline" disabled={busy || !draft.legalQuestion.trim() || !draft.objective.trim()} className="min-h-11 md:min-h-9">{busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}Salvar e revisar perfil</Button>
          </form>
          <section className="space-y-4 border-t pt-5" aria-label="Avaliação"><h3 className="text-sm font-medium">Comparação com o julgado</h3>
            <fieldset className="space-y-1"><legend className="text-sm font-medium">Material</legend>{judgment.fullTextVersionId && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" checked={materialVersionId === judgment.fullTextVersionId} onChange={() => { setMaterialVersionId(judgment.fullTextVersionId!); setAssessment(null); }} />Inteiro teor</label>}{judgment.ementaVersionId && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" checked={materialVersionId === judgment.ementaVersionId} onChange={() => { setMaterialVersionId(judgment.ementaVersionId!); setAssessment(null); }} />Ementa</label>}</fieldset>
            {incompleteProfile && <p className="text-sm text-muted-foreground">O perfil precisa de fatos documentados ou alegados para uma comparação factual.</p>}
            {!profileReviewed && <p className="text-sm text-muted-foreground">Salve e revise o perfil para avaliar este material.</p>}
            <Button type="button" variant="outline" disabled={!canAssess || busy} onClick={() => void assess()} className="min-h-11 md:min-h-9">Avaliar pertinência</Button>
            {assessment && <AssessmentView assessment={assessment} hasThesis={!!profile?.thesis} />}
          </section>
          <section className="space-y-4 border-t pt-5" aria-label="Vínculo ao caso"><h3 className="text-sm font-medium">Finalidade no caso</h3>
            <div className="grid gap-1.5"><Label htmlFor="research-purpose">Usar como</Label><select id="research-purpose" className="h-11 w-full rounded-md border bg-background px-3 text-sm md:h-9" value={purpose} onChange={event => setPurpose(event.target.value as keyof typeof purposeLabels)}>{Object.entries(purposeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div className="grid gap-1.5"><Label htmlFor="research-notes">Anotação privada (opcional)</Label><Textarea id="research-notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={4000} className="min-h-20" /></div>
            {linked ? <p className="text-sm text-muted-foreground">Esta versão já está vinculada. <Link href={`/app/vault/cases/${caseId}?section=references`} onClick={() => setOpen(false)} className="underline underline-offset-2">Ver referências do caso</Link>.</p> : <div className="flex flex-wrap gap-2">{assessment?.status === 'evaluated' && assessment.current && profileReviewed && <Button type="button" disabled={busy} onClick={() => void link(false)} className="min-h-11 md:min-h-9">Adicionar referência</Button>}{assessment && profileReviewed && assessment.current && !['queued', 'running', 'stale', 'evaluated'].includes(assessment.status) && <Button type="button" variant="outline" disabled={busy} onClick={() => void link(true)} className="min-h-11 md:min-h-9">Adicionar sem avaliação</Button>}</div>}
          </section>
        </>}
      </div>
    </SheetContent></Sheet>
  </>;
}

function TextRows({ title, values, onChange }: { title: string; values: string[]; onChange: (values: string[]) => void }) {
  return <fieldset className="space-y-2"><legend className="text-sm font-medium">{title}</legend>{values.map((value, index) => <div key={index} className="flex gap-2"><Input aria-label={`${title} ${index + 1}`} value={value} onChange={event => onChange(values.map((item, i) => i === index ? event.target.value : item))} maxLength={1200} className="h-11 md:h-9" /><Button type="button" variant="ghost" size="icon" className="size-11 md:size-9" aria-label={`Remover ${title.toLowerCase()} ${index + 1}`} onClick={() => onChange(values.filter((_, i) => i !== index))}><X aria-hidden="true" /></Button></div>)}<Button type="button" variant="ghost" onClick={() => onChange([...values, ''])} disabled={values.length >= 40} className="min-h-11 md:min-h-9"><Plus aria-hidden="true" />Adicionar</Button></fieldset>;
}
function FactRows({ title, values, documents, onChange }: { title: string; values: Fact[]; documents: Document[]; onChange: (values: Fact[]) => void }) {
  return <fieldset className="space-y-2"><legend className="text-sm font-medium">{title}</legend>{values.map((fact, index) => <div key={index} className="grid gap-2 border-b py-2 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.55fr)_auto]"><Input aria-label={`Fato documentado ${index + 1}`} value={fact.text} onChange={event => onChange(values.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} maxLength={1200} className="h-11 md:h-9" /><select aria-label={`Arquivo do fato ${index + 1}`} value={fact.documentIds[0] ?? ''} onChange={event => onChange(values.map((item, i) => i === index ? { ...item, documentIds: event.target.value ? [event.target.value] : [], chunkIds: [] } : item))} className="h-11 rounded-md border bg-background px-3 text-sm md:h-9"><option value="">Escolha um arquivo</option>{documents.map(document => <option key={document.id} value={document.id}>{document.name}</option>)}</select><Button type="button" variant="ghost" size="icon" className="size-11 md:size-9" aria-label={`Remover fato documentado ${index + 1}`} onClick={() => onChange(values.filter((_, i) => i !== index))}><X aria-hidden="true" /></Button></div>)}{documents.length === 0 && <p className="text-[13px] text-muted-foreground">Nenhum arquivo pronto neste caso. Registre os fatos ainda sem documento como alegados.</p>}<Button type="button" variant="ghost" onClick={() => onChange([...values, { text: '', documentIds: [], chunkIds: [] }])} disabled={values.length >= 40 || documents.length === 0} className="min-h-11 md:min-h-9"><Plus aria-hidden="true" />Adicionar fato</Button></fieldset>;
}

export function AssessmentView({ assessment, hasThesis }: { assessment: ResearchCaseAssessment; hasThesis: boolean }) {
  const { status, result } = assessment;
  const statusCopy: Record<ResearchCaseAssessment['status'], string> = {
    queued: 'Avaliação aguardando processamento.', running: 'Avaliação em curso.', evaluated: 'Avaliação concluída.',
    incomplete: 'Comparação incompleta: faltam fatos ou trechos suficientes.',
    disabled: 'A avaliação está desligada para este escritório.', unavailable: 'A avaliação está indisponível no momento.',
    budget_exceeded: 'O orçamento de avaliações foi atingido.', stale: 'Esta avaliação está desatualizada. Avalie novamente.',
  };
  return <div className="space-y-3 border-t pt-4 text-sm" aria-live="polite"><p>{statusCopy[status]}</p>{!assessment.current && status !== 'stale' && <p className="text-muted-foreground">Os dados do caso ou do material mudaram. Avalie novamente.</p>}
    {result && <><div className="grid gap-2">{(['legal', 'factual', 'procedural'] as const).map((key, index) => { const answer = result.answers[key]; return <div key={key} className="grid gap-1 border-b py-2 sm:grid-cols-[12rem_minmax(0,1fr)]"><span className="text-muted-foreground">{['Pertinência jurídica', 'Semelhança factual', 'Contexto processual'][index]}</span><span>{answer?.type === 'score' ? `${answer.score.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/4 · Critério mais próximo: ${scoreLabels[key][Math.max(0, Math.min(4, Math.round(answer.score)))]} · ${confidenceText(answer.confidence)}` : 'Não avaliado'}</span></div>; })}</div>
      <p><span className="text-muted-foreground">Relação com a tese: </span>{hasThesis && result.answers.stance?.type === 'choice' ? `${stanceLabels[result.answers.stance.choice] ?? 'Informação insuficiente'} · ${confidenceText(result.answers.stance.confidence)}` : 'Não avaliado'}</p>
      <p><span className="text-muted-foreground">Evidência para comparação: </span>{result.answers.adequacy?.type === 'choice' ? `${adequacyLabels[result.answers.adequacy.choice] ?? 'Não avaliada'} · ${confidenceText(result.answers.adequacy.confidence)}` : 'Não avaliada'}</p>
      <p className="text-muted-foreground">Trechos considerados: {result.coverage.caseChunksUsed} do caso e {result.coverage.materialChunksUsed} do julgado{result.coverage.partial ? '. A cobertura foi parcial.' : '.'}</p>
      {result.excerpts.length > 0 && <details className="border-t pt-3"><summary className="min-h-11 cursor-pointer text-sm font-medium">Trechos considerados</summary><div className="space-y-3 pb-2">{result.excerpts.map(item => <div key={item.id} className="border-b py-2"><p className="text-[13px] text-muted-foreground">{item.source === 'vault' ? 'Caso' : 'Julgado'} · {item.reference}</p><p className="mt-1 whitespace-pre-wrap">{item.excerpt}</p></div>)}</div></details>}
    </>}
  </div>;
}
