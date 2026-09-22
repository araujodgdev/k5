**Correções da auditoria local de desempenho — 22 de setembro de 2026**

Implementação das ações concretas do [relatório original](web-perf-2026-09-22.md), sobre o commit `61dde45`. O relatório original mediu `99ef9a8`; entre essas versões houve outras alterações, incluindo observabilidade. A comparação histórica indica o resultado disponível ao usuário, mas não isola cada mudança desta implementação.

**Carregamento e estabilidade.** O [Início](../apps/web/src/components/command-center.tsx) usa `grid-cols-1`, evitando que conteúdo comprido alargue a coluna mobile. Cada seção e contador recebe sua resposta independentemente; uma busca lenta ou com erro não bloqueia os outros resultados. A saudação e as seções reservam espaço durante a carga, e uma atualização mantém o conteúdo anterior enquanto aguarda a resposta. Datas civis continuam calculadas no fuso do navegador.

O histórico do chat permanece no HTML inicial e sua visibilidade é controlada por CSS responsivo. O [bootstrap da preferência](../apps/web/src/lib/agent-history.ts) aplica o valor salvo antes do primeiro paint, preservando `k5.agent_list_open`, sincronização entre abas e funcionamento sem acesso a localStorage. O padrão continua aberto no desktop e fechado no mobile. A geometria não depende de inserir o painel depois da hidratação.

A [página do Lume](../apps/web/src/app/app/[section]/page.tsx) prepara histórico, conversa selecionada, mensagens e modelos no servidor. As leituras partem de `requireWorkspace()`; [conversationBootstrap](../apps/web/src/lib/ai-store.ts) filtra por escritório e usuário, inclusive para links de conversas mais antigas que a primeira página. A leitura não cria conversas. Se a preparação falhar, o chat usa seu fluxo existente de busca e erro pela API.

O [chat](../apps/web/src/components/agent-chat.tsx) usa `useChat` com `useAISDKRuntime` e `DefaultChatTransport`, eliminando o gerenciamento adicional de conversas do wrapper anterior. O K5 já mantém seus próprios IDs, histórico e persistência. O envio conserva conversa, documentos, modelo, áudio e a mensagem afetada; o servidor continua responsável pelo histórico completo e pelas ferramentas. A escolha do adaptador foi conferida na [documentação do assistant-ui](https://www.assistant-ui.com/docs/runtimes/ai-sdk/overview) e no código instalado.

**Divisão de JavaScript.** Painel de fontes, opções pesquisáveis de modelos e editores da Agenda carregam na abertura. Os helpers da Agenda foram extraídos para [agenda-client.ts](../apps/web/src/lib/agenda-client.ts) e usam [calendar-days.ts](../apps/web/src/lib/calendar-days.ts), impedindo que o Início importe o editor e o polyfill de datas por essa dependência.

O [transporte HTTP](../apps/web/src/lib/capabilities/http-client.ts) foi separado do catálogo de capabilities e da geração de JSON Schema. Os formulários mantêm sua validação de campos; contratos, autorização, origem e escopo continuam validados pelos endpoints no servidor. O adaptador WebMCP mantém a validação de entrada e só é importado quando a funcionalidade está habilitada e o navegador oferece a API. A desmontagem e a troca de rota descartam registros ou imports ainda pendentes.

Na [Agenda](../apps/web/src/components/agenda-workspace.tsx), o debounce se aplica ao texto digitado, sem adicionar 150 ms à carga inicial, paginação ou atualização. A preparação dos vínculos busca uma primeira página de até 100 clientes, em paralelo com casos e integrantes. Clientes referenciados na página e ausentes desse conjunto são consultados individualmente. O novo [seletor de clientes](../apps/web/src/components/client-picker.tsx), usado no filtro e no editor, busca páginas de 25 ao abrir e permite pesquisar e paginar; a inicialização não percorre todo o CRM. O ganho com escritórios grandes não foi quantificado.

**Fontes e acessibilidade.** Inter normal e Newsreader normal mantêm preload. A Newsreader itálica recebe uma declaração separada com `preload: false`, aplicada aos usos de itálico da tipografia serifada. A variante permanece disponível sem disputar a carga inicial das telas auditadas. O README foi corrigido para explicar que as fontes são obtidas durante o build e servidas pela aplicação.

O token `subtle-foreground` no tema claro mudou de `#93938e` para `#696965`, mantendo a paleta neutra do [design system](../apps/web/DESIGN.md). Seu contraste é **5,51:1 sobre branco** e **4,62:1 sobre a superfície selecionada**. No tema escuro, o token existente oferece **6,20:1 sobre o fundo** e **4,68:1 sobre a seleção**. O input de arquivo agora possui nome acessível; o seletor de modelos inclui o modelo visível em seu `aria-label`.

**Validação funcional.** Foram executados `pnpm db:setup`, `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build`. A suíte completa passou com **220 testes**; os oito testes de armazenamento de IA foram repetidos após ampliar o caso de isolamento para outra pessoa do mesmo escritório. O lint final passou sem avisos. ESLint e TypeScript passaram a ignorar `.data`, que contém dados locais e bundles gerados pelos testes de navegador.

- Desktop e mobile: histórico com preferência padrão e salva, abertura e fechamento, **CLS zero nos quatro cenários de inspeção**.
- Início mobile: largura de 390 px sem overflow; menu Mais abre, fecha por Escape e devolve foco ao botão.
- Carregamento independente: tarefa mantida pendente artificialmente enquanto o Cofre terminava; erro controlado seguido por atualização bem-sucedida.
- Editor: abertura sob demanda, pesquisa de cliente fora da primeira página, paginação e valor selecionado no formulário. Os 65 clientes usados nesse cenário foram respostas simuladas no navegador, sem inserção no banco.
- Fontes: abertura sob demanda e fechamento por Escape; input de arquivo com nome acessível.
- Temas claro e escuro: inspeção visual, largura e contraste dos tokens alterados.
- Chat em uma página isolada de teste com o componente real: busca e seleção de modelos, persistência após reload, streaming simulado e regeneração. O corpo enviado continha o modelo selecionado e a mensagem do usuário. Não houve chamada a provedor de IA.
- Nenhum erro de JavaScript foi registrado nas verificações de interface.

O build manteve os avisos conhecidos de tracing de caminho dinâmico em `storage/index.ts`, link de `mammoth` no Windows e aviso experimental de localStorage do Node. Não impediram a compilação. Esta validação cobre o build Next.js local; não representa medição de usuários reais nem validação de um novo deployment de staging.

**Medição da versão final.** Foram coletados **22 relatórios Lighthouse e 22 traces**, sem erro de navegação, entre **11:22 e 11:25 de Brasília**. Lighthouse 13.5.0 e Chromium 153.0.8010.12, build de produção Next.js/Turbopack servido em `localhost:3000`. O protocolo mantém três rodadas mobile por rota, uma desktop por rota e três desktop para Lume; cache HTTP, Cache Storage, service workers e localStorage limpos antes de cada navegação. Mobile: 412 × 823, RTT simulado de 150 ms, 1.638,4 Kbps e CPU 4×. Desktop: perfil padrão, RTT de 40 ms, 10.240 Kbps e CPU 1×.

Medianas mobile, calculadas separadamente por métrica:

| Tela | Performance anterior → final | LCP anterior → final | CLS anterior → final | TBT anterior → final |
| --- | ---: | ---: | ---: | ---: |
| Entrar | 87 → 93 | 3,98 → 2,42 s | 0 → 0 | 82 → 241 ms |
| Início | 73 → 86 | 5,23 → 3,85 s | 0,135 → 0 | 200 → 245 ms |
| Lume | 70 → 83 | 6,13 → 3,09 s | 0 → 0 | 333 → 462 ms |
| Cofre | 89 → 92 | 3,36 → 2,62 s | 0 → 0 | 191 → 180 ms |
| Agenda | 89 → 89 | 3,52 → 2,63 s | 0,023 → 0,023 | 160 → 200 ms |

O LCP mediano caiu cerca de **50% no Lume**, **26% no Início**, **22% no Cofre** e **25% na Agenda**. O FCP permaneceu próximo de 0,92 s. Houve variação relevante: Lume entre 2,42 e 3,88 s; Início entre 2,58 e 3,90 s. O TBT aumentou em quatro comparações históricas e permanece um limite, especialmente no chat; as notas melhores não significam que toda execução de JavaScript foi otimizada. Como os commits e a instrumentação diferem, não é possível atribuir esse aumento a uma mudança isolada sem outra comparação controlada.

LCP mobile bom foi atingido na mediana da entrada; as demais telas ainda estão na faixa que precisa melhorar, acima de 2,5 s. Os valores são de laboratório; **INP e percentil 75 de usuários reais não foram medidos**. TBT não substitui INP. [Definições e avaliação de Web Vitals](https://web.dev/articles/vitals).

| Tela | Performance desktop final | LCP desktop final | CLS desktop final |
| --- | ---: | ---: | ---: |
| Entrar | 100 | 0,74 s | 0 |
| Início | 99 | 0,89 s | 0,009 |
| Lume, mediana de três rodadas | 99 | 0,87 s | 0 |
| Cofre | 99 | 0,83 s | 0 |
| Agenda | 99 | 0,86 s | 0,009 |

O CLS desktop do Lume passou de **0,156 para zero** nas três rodadas finais. A acessibilidade automática retornou **100 nas 22 medições**, sem constituir certificação de todos os fluxos e estados.

**Transferência inicial.** Segunda rodada mobile; valores incluem recursos iniciados durante a coleta, como prefetches.

| Tela | JavaScript anterior → final | Transferência total anterior → final |
| --- | ---: | ---: |
| Entrar | 320,7 → 377,3 KiB | 517,8 → 511,0 KiB |
| Início | 400,8 → 308,2 KiB | 617,6 → 455,6 KiB |
| Lume | 565,5 → 517,7 KiB | 773,0 → 662,8 KiB |
| Cofre | 355,7 → 308,3 KiB | 571,8 → 460,3 KiB |
| Agenda | 405,0 → 317,3 KiB | 612,7 → 462,8 KiB |

As fontes transferidas passaram de **168,0 para 104,7 KiB** em todas as telas. Uma inspeção adicional confirmou duas fontes na carga do chat; inserir texto Newsreader itálico provocou a terceira requisição, validando o carregamento sob demanda. Com JavaScript desabilitado, o parágrafo da resposta já estava no HTML do chat. Com JavaScript habilitado, o carregamento inicial não fez buscas a `/api/conversations` ou `/api/ai/models`; os dados vieram da página do servidor. Evidência em [initial-load.json](../apps/web/.data/web-perf-fixes-2026-09-22/initial-load.json).

**Artefatos.** As verificações ficam em [verification.json](../apps/web/.data/web-perf-fixes-2026-09-22/verification.json), [chat-harness-result.json](../apps/web/.data/web-perf-fixes-2026-09-22/chat-harness-result.json) e [contrast.json](../apps/web/.data/web-perf-fixes-2026-09-22/contrast.json). A [comparação estruturada](../apps/web/.data/web-perf-fixes-2026-09-22/comparison.json) reúne as medianas e transferências. Os relatórios completos estão no [diretório da versão final](../apps/web/.data/web-perf-fixes-2026-09-22/final/), incluindo [Lume mobile, terceira rodada](../apps/web/.data/web-perf-fixes-2026-09-22/final/agents-mobile-r3.html) e [Lume desktop, segunda rodada](../apps/web/.data/web-perf-fixes-2026-09-22/final/agents-desktop-r2.html). Capturas e scripts estão no [diretório local da implementação](../apps/web/.data/web-perf-fixes-2026-09-22/), ignorado pelo Git; esses arquivos não acompanham um clone do repositório.
