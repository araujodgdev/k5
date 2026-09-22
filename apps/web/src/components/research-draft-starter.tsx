'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { requestCapability } from '@/lib/capabilities/http-client';
import type { ResearchCaseReference } from '@/lib/application/research-case-service';

type Document = { id: string; name: string; status: string };
type Candidate = { id: string; sourceLabel: string; text: string; sourceType?: 'vault' | 'research' };
const citationSourceLabel = (label: string) => label
  .replace(/\bfull_text:(\d+)\b/g, 'Inteiro teor · trecho $1')
  .replace(/\bementa:(\d+)\b/g, 'Ementa · trecho $1');

export function ResearchDraftStarter({ caseId, references }: { caseId: string; references: ResearchCaseReference[] }) {
  const [open, setOpen] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [templates, setTemplates] = useState<Document[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [instructions, setInstructions] = useState('');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [approvedCitationIds, setApprovedCitationIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [runId, setRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const load = async () => {
      setLoading(true);
      const [response, libraryResponse] = await Promise.all([
        requestCapability('k5_vault_list_documents', { caseId, scope: 'case', limit: 50 }),
        requestCapability('k5_vault_list_documents', { scope: 'library', limit: 50 }),
      ]);
      if (!live) return;
      if (response.ok) setDocuments((response.data as { documents: Document[] }).documents.filter(item => item.status === 'ready'));
      else setError(response.error);
      if (libraryResponse.ok) {
        const library = (libraryResponse.data as { documents: Document[] }).documents.filter(item => item.status === 'ready');
        const caseDocuments = response.ok ? (response.data as { documents: Document[] }).documents.filter(item => item.status === 'ready') : [];
        setTemplates([...caseDocuments, ...library.filter(item => !caseDocuments.some(document => document.id === item.id))]);
      } else setError(libraryResponse.error);
      setLoading(false);
    };
    void load();
    return () => { live = false; };
  }, [open, caseId]);

  function toggle(value: string, list: string[], write: (values: string[]) => void) {
    write(list.includes(value) ? list.filter(item => item !== value) : [...list, value]);
    setCandidates(null); setApprovedCitationIds([]);
  }
  async function reviewCitations() {
    if (!documentIds.length && !referenceIds.length) return;
    setBusy(true); setError('');
    const response = await requestCapability('k5_citations_list_candidates', { caseId, documentIds, researchReferenceIds: referenceIds });
    if (response.ok) { setCandidates((response.data as { candidates: Candidate[] }).candidates); setApprovedCitationIds([]); }
    else setError(response.error);
    setBusy(false);
  }
  async function start(event: FormEvent) {
    event.preventDefault();
    if (!candidates || !templateId || !instructions.trim() || (!documentIds.length && !referenceIds.length)) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ kind: 'draft', caseId, documentIds, researchReferenceIds: referenceIds, templateId,
          instructions: instructions.trim(), approvedCitationIds }),
      });
      const result = await response.json().catch(() => null) as { run?: { id: string }; error?: string } | null;
      if (!response.ok || !result?.run?.id) throw new Error(result?.error ?? 'Não foi possível iniciar a minuta.');
      setRunId(result.run.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível iniciar a minuta.'); }
    finally { setBusy(false); }
  }
  const available = references.filter(item => item.material?.localAllowed && item.material.materialStatus === 'ready');
  return <><Button type="button" variant="outline" className="min-h-11 md:min-h-9" onClick={() => setOpen(true)}>Preparar minuta</Button>
    <Sheet open={open} onOpenChange={setOpen}><SheetContent side="bottom" className="max-h-[min(92dvh,900px)] gap-0 overflow-y-auto p-0"><SheetTitle className="border-b px-5 py-4 text-base font-medium">Preparar minuta</SheetTitle>
      <form onSubmit={start} className="space-y-5 px-5 py-5">
        {error && <p role="alert" className="flex gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
        {runId ? <div className="space-y-3 text-sm"><p role="status">A minuta está em preparação.</p><Button asChild><Link href={`/app/research/drafts/${encodeURIComponent(runId)}?case=${encodeURIComponent(caseId)}`}>Acompanhar minuta</Link></Button></div> : <>
          <p className="text-sm text-muted-foreground">Escolha os arquivos do caso e as referências jurídicas que devem orientar esta minuta.</p>
          <fieldset><legend className="text-sm font-medium">Arquivos do caso</legend>{loading && <p className="py-3 text-sm text-muted-foreground">Carregando arquivos…</p>}{!loading && documents.length === 0 && <p className="py-3 text-sm text-subtle-foreground">Nenhum arquivo pronto neste caso.</p>}{documents.map(document => <label key={document.id} className="flex min-h-11 items-center gap-3 border-b text-sm"><input type="checkbox" checked={documentIds.includes(document.id)} onChange={() => toggle(document.id, documentIds, setDocumentIds)} /><span className="min-w-0 truncate">{document.name}</span></label>)}</fieldset>
          <fieldset><legend className="text-sm font-medium">Referências jurídicas</legend>{available.length === 0 && <p className="py-3 text-sm text-subtle-foreground">Nenhuma referência disponível neste caso. <Link href="/app/research" onClick={() => setOpen(false)} className="underline underline-offset-2">Abrir Pesquisa</Link>.</p>}{available.map(reference => <label key={reference.id} className="flex min-h-11 items-center gap-3 border-b text-sm"><input type="checkbox" checked={referenceIds.includes(reference.id)} onChange={() => toggle(reference.id, referenceIds, setReferenceIds)} /><span className="min-w-0"><span className="block truncate">{reference.material?.title}</span><span className="block text-[13px] text-muted-foreground">{reference.material?.kind === 'full_text' ? 'Inteiro teor' : 'Ementa'} · versão escolhida para este caso</span></span></label>)}</fieldset>
          <div className="grid gap-1.5"><Label htmlFor="research-draft-template">Modelo de minuta</Label><select id="research-draft-template" className="h-11 rounded-md border bg-background px-3 text-sm md:h-9" value={templateId} onChange={event => setTemplateId(event.target.value)} required><option value="">Escolha um arquivo pronto do Cofre</option>{templates.map(document => <option key={document.id} value={document.id}>{document.name}</option>)}</select>{!loading && templates.length === 0 && <p className="text-[13px] text-muted-foreground">Adicione um modelo de documento pronto à biblioteca ou ao caso antes de criar a minuta.</p>}</div>
          <div className="grid gap-1.5"><Label htmlFor="research-draft-instructions">Pedido da minuta</Label><Textarea id="research-draft-instructions" value={instructions} onChange={event => setInstructions(event.target.value)} minLength={1} maxLength={12000} className="min-h-28" required placeholder="Descreva a peça e o que ela deve abordar." /></div>
          <Button type="button" variant="outline" disabled={busy || (!documentIds.length && !referenceIds.length)} onClick={() => void reviewCitations()} className="min-h-11 md:min-h-9">{busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}Revisar citações</Button>
          {candidates && <fieldset className="border-t pt-4"><legend className="text-sm font-medium">Citações que você autoriza</legend><p className="mt-1 text-[13px] text-muted-foreground">Só os trechos marcados poderão aparecer como citação jurídica na minuta.</p>{candidates.length === 0 && <p className="py-4 text-sm text-subtle-foreground">Nenhum trecho candidato encontrado. Você ainda pode preparar a minuta sem citações jurídicas.</p>}{candidates.map(candidate => <label key={candidate.id} className="flex gap-3 border-b py-3 text-sm"><input type="checkbox" className="mt-1" checked={approvedCitationIds.includes(candidate.id)} onChange={() => setApprovedCitationIds(current => current.includes(candidate.id) ? current.filter(id => id !== candidate.id) : [...current, candidate.id])} /><span><span className="block text-[13px] text-muted-foreground">{citationSourceLabel(candidate.sourceLabel)}</span><span className="mt-1 block whitespace-pre-wrap">{candidate.text}</span></span></label>)}</fieldset>}
          <Button type="submit" disabled={busy || !candidates || !templateId || !instructions.trim()} className="min-h-11 md:min-h-9">Criar minuta</Button>
        </>}
      </form>
    </SheetContent></Sheet>
  </>;
}
