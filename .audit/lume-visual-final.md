# Composição final do Lume — implementação entregue

Data: 07/10/2026. Branch: `feat/lume-agent-canvas`. Handoff explícito do usuário aplicado sobre o gate inicial do brief. Único writer de produção; nenhum filho, commit, PR ou deploy. Alterações anteriores preservadas. Honorários, tarefas, atividade, colaboração e política da unit3 foram integrados pelos serviços e componentes existentes.

## Comportamento entregue

- **Início:** data local, Hoje com tarefas pessoais e tarefas acessíveis dos casos com vencimento até hoje, notificações não lidas e parcelas pendentes. Tarefas pessoais continuam concluíveis inline. Próximas reuniões têm horizonte explicitamente distinto. Casos recentes mostram descrição e timestamp persistidos; Atividade recente usa eventos reais autorizados dos casos, sem atribuir eventos humanos ao Lume. Há carregamento, vazio, falhas independentes e atualização. Honorários e os módulos continuam no shell.
- **Projeção pessoal:** `/api/home` deriva a identidade da sessão e usa os serviços existentes de casos, tarefas e atividade. A projeção de tarefas contém somente ID, título, caso e prazo; não transporta notas nem conversas de delegação. Não amplia autorização geral da Agenda/CRM. Atividade limitada aos seis casos recentes acessíveis e aos oito eventos recentes; as tarefas vencidas são consultadas nos casos acessíveis.
- **Caso:** Tudo é a seção padrão. Reúne páginas autorizadas e arquivos da pasta atual; previews são texto salvo de páginas, com versão/data, e arquivos mostram tamanho/data/estado reais. No desktop há grid; em 390 px, linhas compactas. Tudo/Arquivos compartilham a mesma paginação, sem reset ao alternar. Páginas, Arquivos, Tarefas, Honorários e Atividade continuam visíveis; Mais contém Processos, Referências, Anexos e Participantes. Pastas, acesso a pastas, upload, Drive, agenda, edição e exclusão continuam disponíveis.
- **Compartilhar:** participantes reais na apresentação autorizada; dialog reutiliza associação/participação e a única política efetiva do caso. Explica conversa e memória pessoais, permissões do solicitante e independência do portal. Links de clientes realmente vinculados do escritório pessoal levam ao gerenciador de portal existente. Não fabrica participantes nem publicação no portal.
- **Pedir ao Lume:** foca a conversa privada existente e o contexto registrado do caso para a próxima mensagem. Não envia mensagem; preserva rascunho e conversa. Fluxo desktop/mobile e Enter foram comprovados.
- **Conversa:** saudação com nome real, data/hora local e contexto autorizado; sugestões só preenchem após clique. Upload, áudio, gates legais e controles existentes permanecem. Uma voz Lume, módulos como labels.
- **Ferramentas:** running nasce no boundary real observado `tool-call`, atualiza pelo mesmo `callId`, e completion/approval/failure/interruption são precisos. Aguardando revisão não afirma execução. Cancelamento e confirmação atualizam a linha. O guard de saída foi ajustado para só consumir a chamada quando o resultado completo com destino existir; running não impede a abertura posterior. Proteção de saída tardia e propriedade do recurso preservada.

Princípios aplicados do p3: **Model the Domain** definiu a projeção estreita `HomeOverview`, excluindo dados privados; **Prove It Works** exigiu PostgreSQL real, fixture de streaming explicitamente local e provas nativas de superfície. Arquitetura aceita mantida; não houve nova rodada arquitetural ou revisão cosmética.

## Arquivos tocados neste handoff

Produção, relativos a `apps/web/`:

- `src/lib/home-overview.ts` e `src/app/api/home/route.ts` (novos).
- `src/components/command-center.tsx`.
- `src/lib/case-pages/contracts.ts`, `src/lib/case-pages/service.ts`, `src/components/case-pages.tsx`.
- `src/components/case-sharing.tsx` (novo), `src/components/vault-case-view.tsx` e `src/app/app/(office)/vault/cases/[id]/page.tsx`.
- `src/lib/chat-status.ts`, `src/lib/chat-turn.ts`, `src/components/agent-chat.tsx`, `src/components/lume/lume-workspace.tsx`.
- `DESIGN.md`: regras do Início, caso, greeting e atividade observada atualizadas. Bloco gerado de Next preservado.

Cobertura/expectativas, relativos a `apps/web/`:

- `tests/case-collaboration.test.ts`: projeção do Início com casos compartilhados, prazo/status, dados privados ausentes e revogação real.
- `tests/chat-lease.test.ts`: execução real de `runChatTurn` com provider SSE gravado localmente; running/completed com identidade estável, persistência e resumo real.
- `e2e/lume-composition.e2e.ts` (novo): composição real e contrato frontend local separados.
- `e2e/case-collaboration.e2e.ts`, `e2e/collaboration.e2e.ts`, `e2e/source-round3.e2e.ts`: seções secundárias agora acessadas por Mais.
- `e2e/workspace.e2e.ts`: nova projeção do Início nas fixtures de apresentação, Hoje/vazios e falha parcial recuperável; calendário/ficha mantidos.
- `e2e/editor-repair.e2e.ts`: heading visível de retorno ao Início é Hoje. Demais assertions de editor mantidas.

Não há migração nova deste writer. Nenhuma alteração a `.env.local`, `.data`, serviços/portas do desenvolvedor, guard de tráfego externo ou cache backup em raízes de scan.

## Checks focados e resultados

Todos os comandos de teste usaram `.audit/lume-source-checks.mts` com o estado isolado autoritativo. Raiz de evidência: `apps/web/.e2e/verify/20261006T234247-d88728/`.

| Check | Resultado | Evidência relativa à raiz acima |
| --- | --- | --- |
| `test tests/case-collaboration.test.ts tests/case-pages.test.ts tests/chat-lease.test.ts` | 34/34 PostgreSQL; inclui nova projeção do Início | `source-test-1791381724788/output.log` |
| `test tests/chat-lease.test.ts` após adicionar a execução de ferramentas gravada | 11/11 PostgreSQL; inclui novo teste de stream/persistência | `source-test-1791381918001/output.log` |
| `e2e e2e/lume-composition.e2e.ts`, cenário `contrato de apresentação local...` | 1/1 passou; linhas deduplicadas, label Tarefas, approval pending e cancelamento | `source-e2e-1791382137568/report.json` (outro cenário falhou nessa tentativa) |
| `e2e e2e/lume-composition.e2e.ts --grep 'composição real'` | 1/1 passou, exit 0; 69,72 s | `source-e2e-1791382536914/report.json` e `output.log` |
| `git diff --check` geral e focado | exit 0; avisos LF/CRLF sem erros de whitespace | saída terminal deste handoff |
| `verify-lume doctor` final | `ok:true`, `healthy:true`, seis checks passando | saída terminal; app 62541, PG 62542, HTTP 200 |

Os grupos PG se sobrepõem: 35 testes distintos cobertos, não 45 distintos. O novo arquivo e2e tem seus dois cenários comprovados em execuções focadas finais separadas; o parent ainda executará o arquivo integrado na sua rodada final. Uso de modelo nos reports e2e: zero tokens e zero chamadas. Não houve chamada real a provider externo; a execução de stream PG substitui `fetch` por gravação explícita, e o frontend-contract usa SSE/decisão local. O guard `.audit/lume-no-external-test-traffic.mjs` continua intacto.

Doze caminhos de implementação/evidência foram conferidos ao fechar o relatório. Uma conferência adicional com `core.autocrlf=false` marcou CRLF inteiro como trailing whitespace; a conferência correta com `core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol` passou, exit 0. Nenhum arquivo foi reformatado por esse aviso.

O fluxo real cria contas distintas, convite/associação, participação, página, tarefa compartilhada, tarefa pessoal, cliente vinculado, honorário e **51 arquivos TXT pelas APIs reais**. Confere Hoje, atividade recente, abertura via card, paginação 1–50/51–51 e preservação entre Tudo/Arquivos, abertura real de arquivo, edição de página com leitura de autosave pela API, conversa/rascunho/contexto, política persistida pela API, portal link, 390 px, tema escuro e teclado. A contagem final dos 51 arquivos é uma transação SQL somente leitura.

Tentativas anteriores preservadas: `source-test-1791381853940` corrigiu literal esperado do resumo (produção já emitia running/completed corretos); `source-e2e-1791381954266` corrigiu atividade recente após upload e fixture de decisão com campo `result`; `source-e2e-1791382137568`/`source-e2e-1791382324317` evidenciaram navegação fria acima dos 10 s padrão; esperas de navegação específicas agora aceitam 60 s. `source-e2e-1791382461086` evidenciou que `uncheck()` valida sincronicamente o checkbox controlado antes da resposta; o teste agora clica e verifica API/UI assíncronas. Retorno em navegação real usa `browser.back`, preservando o layout montado. Não se enfraqueceu autorização nem se removeu guarda para passar os testes.

## Evidência visual

Preview nativo T3 disponível após `preview_status`/`preview_open`; utilizado em toda a prova manual. Nenhum browser alternativo. A gravação foi parada e salva. Um erro real de keys duplicadas em componentes irmãos de Compartilhar foi encontrado e corrigido; após reload final, nenhum erro novo de React na snapshot. Histórico antigo permanece na gravação; screenshots finais são posteriores à correção.

Capturas/gravação nativas copiadas para `native-visual-final/`:

- `inicio-desktop.png`, `tudo-desktop.png`: composição com dados reais da conta de verificação.
- `tudo-desktop-dark-after-home-click.png`: caso aberto pelo card real de Casos recentes.
- `tudo-mobile-loading-dark.png`: estado de loading real.
- `tudo-mobile-dark-final.png`: última superfície, 390×844, tema salvo escuro; largura do documento 390, sem overflow. Nova pasta e Enviar arquivos medidos em 44 px.
- `sharing-mobile-dark.png`: dialog real, privacidade e política; área rolável mantém portal e Concluir acessíveis.
- `composition-native.mp4`: gravação desktop/mobile, criação/edição de página, contextualização, política e dark theme; 3.208.866 bytes.

No cenário e2e real final, o prefixo completo de artefatos é:

`source-e2e-1791382536914/artifacts/web/e2e_lume-composition.e2e.ts__composi_C3_A7_C3_A3o_20real_20do_20In_C3_ADcio_20e_20Tudo_20preserva_20contexto_2C-08986eee/default/attempt-0/`

Esse prefixo contém:

- `screenshots/001-inicio-real-desktop.png` (1440×1000).
- `screenshots/002-compartilhamento-real-desktop.png`.
- `screenshots/003-tudo-real-mobile.png` (390×844).
- `screenshots/004-compartilhamento-real-mobile.png`.
- `screenshots/005-tudo-real-mobile-escuro.png`.
- `screenshots/006-conversa-contextual-mobile.png`.
- `video/video.webm` (2.261.489 bytes) e `trace/trace.zip`.

No contrato frontend local aprovado, o prefixo é:

`source-e2e-1791382137568/artifacts/web/e2e_lume-composition.e2e.ts__contrato_20de_20apresenta_C3_A7_C3_A3o_20local_20usa_20uma_20linha_20por_20chamada-4fed2f1c/default/attempt-0/`

Contém screenshots `ferramentas-observadas-fixture-local` e `confirmacao-cancelada-fixture-local`, além de vídeo/trace. É prova de apresentação local, não evidencia execução externa.

## Limites e handoff final

- Parent é responsável pela rodada única de `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` e e2e integrado após esta liberação. Não executei suites amplas em paralelo com edits. Além de `lume-composition`, incluir os arquivos e2e acima com expectativas alteradas e os fluxos existentes de shell/editor/portal conforme seu harness integrado.
- Previews de páginas usam somente conteúdo salvo autorizado. Os DTOs de arquivo não registram autoria/publicação segura para esta superfície; nenhum label de autor, Lume-a-pedido-de ou publicação foi inventado. Arquivos usam ícone e estado/tamanho reais, sem linhas falsas de documento.
- A atividade do Início é um recorte dos seis casos recentes, não um ledger universal. Consulta de tarefas segue os casos acessíveis e pode escalar com a quantidade de casos; não houve redesenho de busca/agregação fora do escopo.
- Portal foi integrado com links reais ao gerenciador existente; publicação/download/revogação continuam sob a cobertura unit3/parent. Não houve contato com clientes nem envios externos. Worker/provider/tribunal não executados. O warning `_bytes` em `transport.ts` é anterior e alheio a esta composição.

**WRITER LIBERADO.** Implementação e checks focados concluídos; todas as sessões de teste e doctor foram drenadas, e a gravação foi encerrada. Nenhum processo de check deste writer permanece ativo. Não haverá outra mutação de produção por este writer. O ambiente isolado saudável `20261006T234247-d88728` permanece ligado em app62541/PG62542 para a validação final do parent; nenhum restart de serviço saudável ou helper `--stop` executado. Estado lido do runDir autoritativo, não de PIDs antigos.
