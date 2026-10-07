import { notFound } from 'next/navigation';
import { Download, Info } from 'lucide-react';
import { requirePlatformPage } from '@/lib/platform';
import { platformFeedback } from '@/lib/feedback-core';
import { preferenceLabels, ratingCriteria } from '@/lib/feedback-contract';
import { DataTable } from '@/components/canvas/canvas-controls';
import { Button } from '@/components/ui/button';
import { AdminBar, AdminBlock, AdminBlockHead, AdminDetailHead, AdminFact, AdminFacts, AdminFooter, AdminGrid, AdminNote, adminButton } from '@/components/admin/admin-blocks';
import { AdminMeta } from '@/components/admin/admin-meta';

export const metadata = { title: 'Histórico A/B' };

const exports = [
  { href: '/api/platform/feedback', label: 'Exportar avaliações em JSON' },
  { href: '/api/platform/feedback?format=dataset', label: 'Exportar base para avaliação e curadoria' },
  { href: '/api/platform/feedback?history=1', label: 'Exportar histórico das rodadas' },
];

export default async function PlatformFeedbackHistoryPage() {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const data = await platformFeedback(context.db, context.user.id);
  const name = (key: string) => data.models.find(model => model.key === key)?.name ?? key;
  const scores = (model: string, criterion: typeof ratingCriteria[number]['key']) => data.votes
    .flatMap(vote => vote.assessments.filter(assessment => assessment.model === model).map(assessment => assessment[criterion]))
    .filter((value): value is number => value !== null);
  const average = (values: number[]) => values.length
    ? `${(values.reduce((sum, value) => sum + value, 0) / values.length).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} / 5`
    : 'Sem notas';
  return <>
    <AdminMeta title="Histórico A/B" />
    <AdminDetailHead back={{ href: '/app/admin/feedback', label: 'Voltar para feedback' }} title="Histórico A/B"
      sub={`${data.title} · ${data.votes.length} ${data.votes.length === 1 ? 'avaliação' : 'avaliações'} · Um voto por usuário, antes da revelação dos modelos.`} />
    <AdminGrid>
      <AdminBlock label="Exportar">
        <AdminBar actions={exports.map(item => (
          <Button key={item.href} asChild variant="outline" className={adminButton}><a download href={item.href}><Download aria-hidden />{item.label}</a></Button>
        ))} />
        <AdminNote icon={Info}>Inclui contexto, arquivos, origem e avaliações com autorização de uso, sem nomes ou escritórios. Preferências precisam de revisão antes de treinamento; respostas para SFT precisam de revisão especializada. Saídas da Meta e Inception ficam restritas à avaliação até revisão dos termos aplicáveis.</AdminNote>
      </AdminBlock>
      <AdminBlock labelledBy="ab-models">
        <AdminBlockHead id="ab-models" title="Preferências e médias por modelo" sub="Notas de 1 a 5. “Não avaliei” não entra na média. Preferências de usuários deste piloto não equivalem à pontuação oficial do Harvey LAB." />
        {data.votes.length === 0 ? <p className="text-[13.5px] text-muted-foreground">Nenhuma avaliação recebida.</p> : <>
          <DataTable label="Preferências e médias por modelo" tall rows={data.models} rowKey={model => model.key} columns={[
            { header: 'Modelo', width: 'minmax(0, 1fr)', strong: true, cell: model => model.name },
            { header: 'Comparações', width: '96px', align: 'end', mono: true, phone: false, cell: model => data.votes.filter(vote => vote.assessments.some(assessment => assessment.model === model.key)).length },
            { header: 'Preferências', width: '96px', align: 'end', mono: true, phone: false, cell: model => data.votes.filter(vote => vote.preferredModel === model.key).length },
            ...ratingCriteria.map(criterion => ({
              header: criterion.label, width: '104px', align: 'end' as const, mono: true,
              cell: (model: { key: string }) => average(scores(model.key, criterion.key)),
              sub: (model: { key: string }) => { const total = scores(model.key, criterion.key).length; return `${total} ${total === 1 ? 'nota' : 'notas'}`; },
            })),
          ]} />
          <AdminFooter>{(['tie', 'neither', 'unsure'] as const).map(key => `${preferenceLabels[key]}: ${data.votes.filter(vote => vote.preference === key).length}`).join(' · ')}</AdminFooter>
        </>}
      </AdminBlock>
      {data.votes.length > 0 && <AdminBlock card labelledBy="ab-votes">
        <AdminBlockHead id="ab-votes" title="Comentários e notas individuais" />
        <div className="flex flex-col">
          {data.votes.map(vote => (
            <article key={vote.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">{vote.userName} · {vote.officeName}</h3>
                <span className="font-mono text-[12.5px] text-muted-foreground">{vote.createdAt} UTC</span>
              </div>
              <p className="text-[13.5px]">Preferência: {vote.preferredModel ? name(vote.preferredModel) : preferenceLabels[vote.preference]}</p>
              {vote.comment && <p className="text-[13.5px] break-words whitespace-pre-wrap">{vote.comment}</p>}
              <div className="grid gap-3 md:grid-cols-2">
                {vote.assessments.map(assessment => (
                  <div key={assessment.side} className="flex min-w-0 flex-col gap-2.5 rounded-md bg-muted p-3">
                    <h4 className="text-[13.5px] font-medium">{name(assessment.model)} <span className="font-normal text-muted-foreground">(Resposta {assessment.side.toUpperCase()})</span></h4>
                    <AdminFacts>{ratingCriteria.map(criterion => <AdminFact key={criterion.key} label={criterion.label} mono>{assessment[criterion.key] ?? 'Não avaliei'}</AdminFact>)}</AdminFacts>
                    <p className="text-[13.5px] break-words whitespace-pre-wrap">{assessment.comment || 'Sem comentário sobre esta resposta.'}</p>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </AdminBlock>}
    </AdminGrid>
  </>;
}
