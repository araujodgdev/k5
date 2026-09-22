/** Synthetic review queue. No item has been labeled by a lawyer or used to calibrate thresholds. */
const profiles = [
  { id: 'grandmother-documented', legalQuestion: 'Quando a avó pode obter a guarda?', objective: 'Avaliar guarda à avó.', thesis: 'A guarda deve permanecer com a avó.', documentedFacts: ['A avó cuida da criança há três anos, conforme relatório escolar.'], allegedFacts: [], gaps: [] },
  { id: 'grandfather-documented', legalQuestion: 'Quando o avô pode obter a guarda?', objective: 'Avaliar guarda ao avô.', thesis: 'A guarda deve permanecer com o avô.', documentedFacts: ['O avô assumiu cuidados diários após doença da mãe.'], allegedFacts: [], gaps: [] },
  { id: 'financial-only', legalQuestion: 'Mera conveniência financeira justifica guarda à avó?', objective: 'Avaliar pedido de guarda.', thesis: 'Renda superior basta para a guarda.', documentedFacts: ['A avó tem renda maior que os pais.'], allegedFacts: [], gaps: ['Não há relato de cuidado diário pela avó.'] },
  { id: 'grandmother-alleged', legalQuestion: 'A guarda provisória à avó é cabível?', objective: 'Preparar pedido provisório.', thesis: 'A avó é a cuidadora principal.', documentedFacts: [], allegedFacts: ['A avó diz cuidar da criança há seis meses.'], gaps: ['Falta relatório da escola.'] },
  { id: 'procedural-difference', legalQuestion: 'É possível discutir guarda em recurso contra medida protetiva?', objective: 'Examinar via processual.', thesis: 'O recurso comporta pedido de guarda.', documentedFacts: ['Há decisão em medida protetiva.'], allegedFacts: [], gaps: ['Não há sentença de guarda.'] },
  { id: 'missing-facts', legalQuestion: 'Qual precedente ajuda no pedido de guarda?', objective: 'Pesquisar possibilidades.', thesis: null, documentedFacts: [], allegedFacts: [], gaps: ['Fatos do cuidado ainda não informados.'] },
] as const;

const judgments = [
  { id: 'grandmother-support', tribunal: 'TJDFT', materialKind: 'ementa', text: 'Guarda à avó deferida quando cuidado continuado e vínculo afetivo estão comprovados, preservado o melhor interesse da criança.' },
  { id: 'grandmother-oppose', tribunal: 'TJDFT', materialKind: 'ementa', text: 'Guarda à avó indeferida apesar de cuidado anterior, pois a prova atual indica capacidade dos pais e ausência de risco.' },
  { id: 'grandfather-care', tribunal: 'STJ', materialKind: 'ementa', text: 'Guarda ao avô examinada diante de cuidado diário comprovado e impedimento temporário da mãe.' },
  { id: 'financial', tribunal: 'TJDFT', materialKind: 'ementa', text: 'Condição econômica superior de parente, isoladamente, não justifica alterar a guarda exercida pelos pais.' },
  { id: 'procedural', tribunal: 'TJDFT', materialKind: 'ementa', text: 'Pedido de guarda não apreciado em recurso restrito a medida protetiva; necessária via própria.' },
  { id: 'unrelated', tribunal: 'STJ', materialKind: 'ementa', text: 'Acórdão sobre prescrição tributária e execução fiscal, sem questão de família.' },
] as const;

export type ResearchEvaluationPair = {
  id: string; split: 'development' | 'holdout'; reviewStatus: 'needs_human_label'; humanLabel: null;
  profile: typeof profiles[number]; judgment: typeof judgments[number];
};

export const researchEvaluationPairs: ResearchEvaluationPair[] = profiles.flatMap((profile, profileIndex) =>
  judgments.map((judgment, judgmentIndex) => ({
    id: `${profile.id}__${judgment.id}`,
    split: (profileIndex * judgments.length + judgmentIndex) % 4 === 0 ? 'holdout' as const : 'development' as const,
    reviewStatus: 'needs_human_label' as const, humanLabel: null,
    profile, judgment,
  })));
