# Tarefas e Agenda

## Objetivo e primeiro ciclo

Substituir Pesquisa por `/app/agenda`, com três visões: tarefas, calendário mensal
com agenda do dia e clientes. `/app/research` redireciona para a nova área.
O módulo pertence ao escritório; administrador e advogado editam, revisor consulta.

Clientes têm contato, etapa de relacionamento (potencial, ativo ou arquivado),
observações e vínculos com casos existentes. Os dados opcionais de cliente já
registrados no Cofre são preservados: não deduplicar pessoas por nome nem importar
automaticamente dados que podem representar pessoas diferentes.

Atividades são tarefas ou reuniões. Tarefas podem não ter data; reuniões exigem
início e fim. Ambas têm estado, responsável opcional, observações e vínculos com
cliente e caso. Conclusão e cancelamento preservam histórico; não há exclusão física.
Datas de tarefas são datas civis; reuniões usam instantes ISO com offset obrigatório,
normalizados em UTC. A interface exibe reuniões no fuso do navegador e informa o fuso.
Datas de tarefas não são contagens automáticas de prazo processual.

## Arquitetura e integração

- Migração aditiva SQLite, compatível com o adaptador D1, sem alterar dados existentes.
- Clientes, associação cliente/caso e atividades sempre vinculados a `office_id`.
- Contratos Zod serializáveis, serviço de aplicação, capacidades e rotas HTTP.
- Interface, ferramentas Mastra e WebMCP convergem em `runCapability`, com revalidação
  do vínculo e papel, validação de entrada e saída e idempotência existente.
- Atualizações exigem versão: edição concorrente retorna conflito, sem sobrescrever.
- Todo cliente, caso e responsável informado é validado no escritório autenticado.
- Cofre oferece acesso à agenda filtrada pelo caso; a agenda abre os casos no Cofre.
- Ferramentas consultam, criam e atualizam clientes e atividades e listam responsáveis.
  O agente deve consultar registros antes de alterar, esclarecer horários ambíguos e
  distinguir atividades humanas das tarefas de geração de documentos (`k5_runs_*`).

## Interface

Seguir `apps/web/DESIGN.md`: superfície única, tokens existentes, título Newsreader,
controles Inter, estados em texto e separadores discretos. Calendário mensal é um
seletor de dia acessível por teclado; detalhes aparecem abaixo no celular. Formulários
usam componentes existentes e rótulos explícitos. Listas incluem busca, filtros,
paginação e acesso à edição. Revisor não recebe controles de escrita.

## Validação

Cobrir isolamento de escritórios, papel somente leitura, referências externas,
datas inválidas, reuniões atravessando dias, tarefas sem data, conclusão/cancelamento,
concorrência, idempotência e publicação das ferramentas. Executar lint, typecheck,
testes e build após setup local. Verificar desktop e celular, teclado e estados.

## Evolução posterior

Sincronização Google/Outlook, convites externos, recorrência, lembretes e notificações,
participantes múltiplos, histórico detalhado de relacionamento e automações de CRM.
Publicações judiciais podem originar sugestões futuras; cálculo de prazos depende
de regras e revisão próprias. Não criar compromissos a partir de publicações
automaticamente neste ciclo. Não publicar nem implantar durante esta implementação.

## Resultado da implementação — 21/09/2026

Primeiro ciclo implementado, com nove capacidades de CRM/agenda publicadas para Mastra
e WebMCP. Navegação desktop e móvel substituída; Pesquisa redireciona; casos do Cofre
abrem a agenda filtrada. Formulários permitem cadastro, edição, reagendamento,
conclusão, cancelamento, reabertura e arquivamento de clientes. Nenhum serviço externo
de calendário ou notificação foi conectado.

Validação concluída: `pnpm db:setup`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
(161 testes aprovados), `pnpm build` e `git diff --check`. O build mantém avisos na
camada existente de armazenamento sobre rastreamento dinâmico de arquivos e no cache
Turborepo/Windows sobre nome de link longo; ambos sem falha da compilação.

No navegador local, verificados cadastro de cliente vinculado ao Cofre, tarefa com
responsável e cliente, conclusão preservando vínculos, reunião, rejeição de intervalo
inválido, calendário por teclado, foco e Escape no formulário, estado vazio/carregando,
redirecionamento de Pesquisa e layout desktop/móvel sem rolagem horizontal. Os três
registros sintéticos usados nessa validação foram removidos ao terminar.

As ferramentas foram verificadas pelos contratos, catálogo e executor real nos testes;
não houve chamada paga a um modelo externo nem implantação. A validação de banco foi
local com SQLite, usando a interface compartilhada com D1; execução remota em D1
continua sendo uma etapa de homologação antes da implantação.
