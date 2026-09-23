import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePlatformPage } from '@/lib/platform';
import { platformFeedback } from '@/lib/feedback-core';
import { preferenceLabels, ratingCriteria } from '@/lib/feedback-contract';

export const metadata = { title: 'Histórico A/B' };

export default async function PlatformFeedbackHistoryPage() {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const data = await platformFeedback(context.db, context.user.id);
  const name = (key: string) => data.models.find(model => model.key === key)?.name ?? key;
  return <section className="mx-auto max-w-6xl">
    <Link href="/platform/feedback" className="inline-flex min-h-11 items-center rounded-md text-muted-foreground text-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 md:min-h-0">← Feedback</Link>
    <header className="mt-5 flex flex-wrap items-center justify-between gap-4"><h1 className="page-title">Histórico A/B</h1>
      <a download className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2" href="/api/platform/feedback">Exportar avaliações em JSON</a>
    </header>
    <div className="mt-4 border-b pb-4 text-sm">
      <a download className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2" href="/api/platform/feedback?format=dataset">Exportar base para avaliação e curadoria</a>
      <a download className="ml-4 inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2" href="/api/platform/feedback?history=1">Exportar histórico das rodadas</a>
      <p className="max-w-3xl text-xs text-muted-foreground">Inclui contexto, arquivos, origem e avaliações com autorização de uso, sem nomes ou escritórios. Preferências precisam de revisão antes de treinamento; respostas para SFT precisam de revisão especializada. Saídas da Meta e Inception ficam restritas à avaliação até revisão dos termos aplicáveis.</p>
    </div>
    <p className="mt-4 text-sm text-muted-foreground">{data.title} · {data.votes.length} {data.votes.length === 1 ? 'avaliação' : 'avaliações'} · Um voto por usuário, antes da revelação dos modelos.</p>
    <p className="mt-2 text-xs text-muted-foreground">Notas de 1 a 5. “Não avaliei” não entra na média. Preferências de usuários deste piloto não equivalem à pontuação oficial do Harvey LAB.</p>
    {data.votes.length === 0 ? <div className="py-12"><p className="text-muted-foreground">Nenhuma avaliação recebida.</p></div> : <>
      <div className="mt-8 overflow-x-auto"><table className="w-full text-left text-sm">
        <caption className="sr-only">Preferências e médias por modelo</caption>
        <thead className="border-b text-xs text-muted-foreground"><tr><th className="py-3 pr-5 font-normal">Modelo</th><th className="px-4 py-3 font-normal">Comparações</th><th className="px-4 py-3 font-normal">Preferências</th>{ratingCriteria.map(c => <th key={c.key} className="px-4 py-3 font-normal">{c.label}</th>)}</tr></thead>
        <tbody>{data.models.map(model => <tr key={model.key} className="border-b"><th className="py-5 pr-5 font-medium">{model.name}</th><td className="px-4 py-5">{data.votes.filter(v => v.assessments.some(a => a.model === model.key)).length}</td><td className="px-4 py-5">{data.votes.filter(v => v.preferredModel === model.key).length}</td>
          {ratingCriteria.map(c => {
            const values = data.votes.flatMap(v => v.assessments.filter(a => a.model === model.key).map(a => a[c.key])).filter((v): v is number => v !== null);
            return <td key={c.key} className="whitespace-nowrap px-4 py-5 tabular-nums">{values.length ? `${(values.reduce((sum, v) => sum + v, 0) / values.length).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} / 5` : 'Sem notas'}<span className="mt-1 block text-xs text-muted-foreground">{values.length} notas</span></td>;
          })}</tr>)}</tbody>
      </table></div>
      <p className="mt-4 text-sm text-muted-foreground">{(['tie', 'neither', 'unsure'] as const).map(key => `${preferenceLabels[key]}: ${data.votes.filter(v => v.preference === key).length}`).join(' · ')}</p>
      <h2 className="mt-10 mb-3 font-medium">Comentários e notas individuais</h2>
      <div className="divide-y">{data.votes.map(vote => <article key={vote.id} className="py-5">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-medium">{vote.userName} · {vote.officeName}</h3><span className="text-xs text-muted-foreground">{vote.createdAt} UTC</span></div>
        <p className="mt-2 text-sm">Preferência: {vote.preferredModel ? name(vote.preferredModel) : preferenceLabels[vote.preference]}</p>
        {vote.comment && <p className="mt-3 whitespace-pre-wrap break-words text-sm">{vote.comment}</p>}
        <div className="mt-4 grid gap-5 md:grid-cols-2">{vote.assessments.map(assessment => <div key={assessment.side} className="min-w-0 text-sm">
          <h4 className="font-medium">{name(assessment.model)} <span className="font-normal text-muted-foreground">(Resposta {assessment.side.toUpperCase()})</span></h4>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">{ratingCriteria.map(c => <div key={c.key}><dt className="text-muted-foreground">{c.label}</dt><dd>{assessment[c.key] ?? 'Não avaliei'}</dd></div>)}</dl>
          <p className="mt-3 whitespace-pre-wrap break-words">{assessment.comment || 'Sem comentário sobre esta resposta.'}</p>
        </div>)}</div>
      </article>)}</div>
    </>}
  </section>;
}
