'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ratingCriteria, preferenceLabels, type Assessment, type FeedbackInput, type FeedbackResponse, type FeedbackView } from '@/lib/feedback-contract';

const emptyAssessment = (): Assessment => ({ clarity: null, accuracy: null, completeness: null, usefulness: null, comment: '' });
const number = (value: number) => value.toLocaleString('pt-BR');
const linkStyle = 'inline-flex min-h-11 items-center rounded-md px-2 text-sm underline underline-offset-4 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 md:min-h-9';

function ResponseReview({ response, assessment, onChange, locked, campaignId }: {
  response: FeedbackResponse; assessment: Assessment; onChange: (value: Assessment) => void; locked: boolean;
  campaignId: string;
}) {
  const [document, setDocument] = useState<'memo' | 'tracker'>('memo');
  const side = response.side;
  const title = `Resposta ${side.toUpperCase()}`;
  return <section aria-labelledby={`response-${side}`} className="min-w-0">
    <header className="flex flex-wrap items-baseline justify-between gap-2 pb-3">
      <h3 id={`response-${side}`} className="text-lg font-medium">{title}</h3>
      {response.identity && <span className="text-sm text-muted-foreground">{response.identity.name}</span>}
    </header>
    <div className="flex flex-wrap items-center justify-between gap-2 border-y py-1">
      <div className="flex gap-1" role="group" aria-label={`Prévia da ${title}`}>
        <Button type="button" variant={document === 'memo' ? 'secondary' : 'ghost'} className="min-h-11 md:min-h-9" aria-pressed={document === 'memo'} onClick={() => setDocument('memo')}>Memorando</Button>
        <Button type="button" variant={document === 'tracker' ? 'secondary' : 'ghost'} className="min-h-11 md:min-h-9" aria-pressed={document === 'tracker'} onClick={() => setDocument('tracker')}>Planilha</Button>
      </div>
      <a download className={linkStyle} href={`/api/feedback/files/${side}/${document}?campaign=${encodeURIComponent(campaignId)}`} aria-label={`Baixar ${document === 'memo' ? 'Word' : 'Excel'} da ${title}`}>Baixar {document === 'memo' ? 'Word' : 'Excel'}</a>
    </div>
    <div className="h-[24rem] overflow-auto py-5 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset md:h-[28rem]" tabIndex={0} role="region" aria-label={`${document === 'memo' ? 'Memorando' : 'Planilha'} da ${title}`}>
      {document === 'memo' ? <Markdown text={response.memo} /> : response.sheets.map(sheet => <section key={sheet.name} className="mb-6">
        <h4 className="mb-3 font-medium">{sheet.name}</h4>
        <table className="text-left text-xs"><tbody>{sheet.rows.map((row, i) => <tr key={i} className="border-b">{row.map((cell, j) => <td key={j} className="min-w-28 max-w-80 whitespace-pre-wrap px-3 py-3 align-top break-words">{cell}</td>)}</tr>)}</tbody></table>
      </section>)}
    </div>
    <p className="border-t py-3 text-xs text-muted-foreground">Prévia do conteúdo. Baixe o arquivo para avaliar a formatação original.</p>
    {response.identity && <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y py-4 text-sm">
      {[
        ['Tempo total', `${number(response.identity.seconds)} s`], ['Turnos', number(response.identity.turns)],
        ['Tokens de entrada', number(response.identity.inputTokens)], ['Tokens de saída', number(response.identity.outputTokens)],
      ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 tabular-nums">{value}</dd></div>)}
    </dl>}
    <fieldset disabled={locked} className="mt-6">
      <legend className="font-medium">Suas notas para {title}</legend>
      <p className="mt-1 text-xs text-muted-foreground">1 = muito ruim · 5 = excelente. Deixe sem nota o que não avaliou.</p>
      <div className="mt-3 divide-y">{ratingCriteria.map(criterion => <div key={criterion.key} className="flex items-center justify-between gap-3 py-3">
        <div><Label htmlFor={`${side}-${criterion.key}`}>{criterion.label}</Label><p className="mt-1 text-xs text-muted-foreground">{criterion.help}</p></div>
        <select id={`${side}-${criterion.key}`} name={`${side}-${criterion.key}`} aria-label={`${criterion.label} da ${title}`} value={assessment[criterion.key] ?? ''}
          onChange={event => onChange({ ...assessment, [criterion.key]: event.target.value ? Number(event.target.value) : null })}
          className="min-h-11 max-w-36 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 disabled:opacity-70 md:min-h-9">
          <option value="">Não avaliei</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>)}</div>
      <div className="mt-4 grid gap-2"><Label htmlFor={`${side}-comment`}>Comentários sobre {title}</Label>
        <Textarea id={`${side}-comment`} value={assessment.comment} maxLength={2000} rows={3} onChange={event => onChange({ ...assessment, comment: event.target.value })} placeholder="O que funcionou? O que precisa melhorar? Cite um trecho, se possível." />
      </div>
    </fieldset>
  </section>;
}

export function FeedbackWorkspace({ initial }: { initial: FeedbackView }) {
  const [view, setView] = useState(initial);
  const [a, setA] = useState(initial.vote?.a ?? emptyAssessment());
  const [b, setB] = useState(initial.vote?.b ?? emptyAssessment());
  const [preference, setPreference] = useState<FeedbackInput['preference'] | ''>(initial.vote?.preference ?? '');
  const [comment, setComment] = useState(initial.vote?.comment ?? '');
  const [reviewed, setReviewed] = useState(Boolean(initial.vote));
  const [trainingConsent, setTrainingConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const status = useRef<HTMLDivElement>(null);
  const locked = Boolean(view.vote) || pending;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || view.vote) return;
    if (!preference || !reviewed) { setError('Escolha uma preferência e confirme que examinou as duas respostas.'); return; }
    setPending(true); setError('');
    try {
      const response = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: view.campaignId, preference, a, b, comment, reviewedBoth: reviewed, trainingConsent }), signal: AbortSignal.timeout(30_000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível salvar. Tente novamente.');
      const next = body.view as FeedbackView;
      setView(next); setA(next.vote!.a); setB(next.vote!.b); setPreference(next.vote!.preference); setComment(next.vote!.comment);
      setSavedMessage(body.saved ? 'Avaliação salva. Os modelos e as métricas estão revelados abaixo.' : 'Sua avaliação anterior já estava salva. Os modelos estão revelados abaixo.');
      requestAnimationFrame(() => { status.current?.focus(); status.current?.scrollIntoView({ behavior: 'instant', block: 'start' }); });
    } catch (cause) { setError(cause instanceof Error && cause.name !== 'TimeoutError' && cause.name !== 'TypeError' ? cause.message : 'Não foi possível confirmar o envio. Suas notas continuam aqui; tente novamente.'); }
    finally { setPending(false); }
  }

  return <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8 md:py-8">
    <div className="mx-auto max-w-6xl">
      <header className="mb-7"><h1 className="display text-[28px]">Avaliar respostas</h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">Compare dois trabalhos produzidos para a mesma tarefa. {view.vote ? 'Sua avaliação foi registrada antes da revelação dos modelos.' : 'Os nomes dos modelos e suas métricas ficam ocultos até você enviar sua avaliação.'}</p>
      </header>
      <section className="mb-7 border-y py-4" aria-labelledby="assignment-title">
        <h2 id="assignment-title" className="font-medium">{view.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">Piloto Harvey LAB · 13 documentos sintéticos em inglês · Memorando e planilha de riscos</p>
        <details className="mt-3"><summary className="w-fit cursor-pointer rounded-md py-2 text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2">Ler a tarefa e consultar as fontes</summary>
          <div className="mt-3 max-w-4xl text-sm"><Markdown text={view.instructions} /></div>
          <div className="mt-3 flex flex-wrap gap-3"><a download className={linkStyle} href={`/api/feedback/files/sources/zip?campaign=${encodeURIComponent(view.campaignId)}`}>Baixar os 13 documentos de origem</a><a className={linkStyle} href="https://github.com/harveyai/harvey-labs" target="_blank" rel="noreferrer">Sobre o Harvey LAB</a></div>
        </details>
      </section>
      <div ref={status} tabIndex={-1} role="status" className="scroll-mt-4 outline-none">
        {(view.vote || savedMessage) && <p className="mb-6 text-sm">{savedMessage || `Você escolheu: ${preferenceLabels[view.vote!.preference]}. Sua avaliação está salva.`} A avaliação não pode ser alterada após a revelação.</p>}
      </div>
      <form onSubmit={submit}>
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-8">
          {view.responses.map(response => <ResponseReview key={response.side} response={response} assessment={response.side === 'a' ? a : b} onChange={response.side === 'a' ? setA : setB} locked={locked} campaignId={view.campaignId} />)}
        </div>
        <fieldset disabled={locked} className="mt-10 border-t pt-6">
          <legend className="sr-only">Preferência final</legend>
          <h2 className="font-medium">Qual trabalho você preferiu?</h2>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">{Object.entries(preferenceLabels).map(([value, label]) => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name="preference" value={value} required checked={preference === value} onChange={() => setPreference(value as FeedbackInput['preference'])} className="size-4 accent-foreground focus-visible:outline-2 focus-visible:outline-offset-4" />{label}
          </label>)}</div>
          <div className="mt-5 grid max-w-3xl gap-2"><Label htmlFor="feedback-comment">O que mais pesou na sua escolha? <span className="font-normal text-muted-foreground">(opcional)</span></Label>
            <Textarea id="feedback-comment" value={comment} onChange={event => setComment(event.target.value)} rows={3} maxLength={3000} />
          </div>
          {!view.vote && <label className="mt-5 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={reviewed} required onChange={event => setReviewed(event.target.checked)} className="size-4 shrink-0 accent-foreground" />Examinei as duas respostas antes de escolher.</label>}
          {!view.vote && <label className="mt-2 flex min-h-11 max-w-3xl items-start gap-3 py-2 text-sm"><input type="checkbox" checked={trainingConsent} onChange={event => setTrainingConsent(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-foreground" />Autorizo usar minhas notas, preferências e comentários para preparar dados de treinamento de IA, sem meu nome ou escritório na exportação. É opcional. Não inclua informações pessoais ou sigilosas nos comentários.</label>}
        </fieldset>
        {view.vote ? <p className="mt-6 pb-6 text-xs text-muted-foreground">Tempos incluem API e ferramentas. Tokens de entrada são cumulativos. Uma execução por modelo; estas métricas não medem qualidade jurídica.</p> : <div className="mt-5 pb-6">
          <p className="max-w-3xl text-xs text-muted-foreground">Suas notas e comentários, associados ao seu nome e escritório, serão vistos pela administração da plataforma. Um envio por pessoa; depois de conhecer os modelos, não será possível alterar o voto.</p>
          {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending} className="mt-5 min-h-11 px-5">{pending ? 'Salvando avaliação…' : 'Enviar avaliação e revelar modelos'}</Button>
        </div>}
      </form>
    </div>
  </div>;
}
