/** Source codes stay internal; the UI gives a recovery-oriented message in pt-BR. */
export function researchSourceMessage(code: string | null | undefined): string {
  if (!code) return 'Uma fonte não pôde concluir a consulta.';
  const messages: Record<string, string> = {
    no_source_enabled: 'Nenhuma fonte de consulta temática está habilitada para estes filtros. Os resultados conhecidos do acervo continuam disponíveis.',
    source_import_required: 'O inteiro teor desta fonte depende da importação de um recurso oficial pelo operador.',
    budget_exceeded: 'O limite de consultas da fonte foi atingido. Tente mais tarde.',
    rate_limited: 'A fonte pediu uma pausa nas consultas. Tente mais tarde.',
    source_unavailable: 'A fonte está indisponível neste momento.',
    source_records_quarantined: 'Parte dos julgados não pôde ser confirmada na fonte.',
    schema_changed: 'A fonte mudou o formato dos dados. Seus resultados do acervo continuam disponíveis.',
    not_found_in_source: 'O material não foi encontrado na fonte oficial.',
    forbidden: 'A fonte não permite acesso a este material.',
    restricted: 'O acesso a este material foi restringido pela fonte.',
    source_disabled: 'A consulta a esta fonte ainda não está disponível.',
    source_documents_not_permitted: 'A fonte não permite obter este documento.',
  };
  return messages[code] ?? 'Uma fonte não pôde concluir a consulta. Seus resultados do acervo continuam disponíveis.';
}
