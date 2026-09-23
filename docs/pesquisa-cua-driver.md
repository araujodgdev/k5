# Cua Driver para o serviço de automação do Lume

Pesquisa em 22/09/2026. Escopo: `libs/cua-driver` do repositório oficial `trycua/cua`. Esta nota distingue capacidade verificada na fonte, limitações declaradas e propostas para o K5. Nenhum binário foi instalado nem automação executada.

Base de leitura: commit [`d1a01f8580d5963702427b9e110fbcd98c39fac3`](https://github.com/trycua/cua/commit/d1a01f8580d5963702427b9e110fbcd98c39fac3), de 22/09/2026. O manifesto npm nessa revisão declara `0.28.2`; isso não prova que toda funcionalidade presente em `main` exista no pacote publicado. A release nominal [`cua-driver-rs-v0.28.2`](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.28.2) foi publicada em 15/09/2026. A própria release explica que o selo GitHub “Pre-release” serve para organizar os produtos do monorepo: versões SemVer sem sufixo são consideradas estáveis pelo projeto, enquanto os builds Linux continuam descritos como preview. [Manifesto npm](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/typescript/package.json).

## Conclusão para a arquitetura

**Proposta, ainda não decisão:** construir um serviço próprio de execuções duráveis, com um executor próximo ao navegador e o Cua Driver como adaptador local. O Driver fornece observação e ações; a API remota, fila, identidade do escritório, isolamento, credenciais, retomada, artefatos e interação humana ficam sob responsabilidade do Lume. Essa separação decorre de o Driver operar o desktop do host e de suas interfaces principais serem locais. Ele não é, sozinho, um serviço SaaS de browsers isolados. [Integração oficial](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/docs/content/docs/how-to-guides/driver/connect-your-agent.mdx), [modelo de processos](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/docs/content/docs/reference/cua-driver/process-model.mdx).

```text
Lume → serviço de automação → fila/estado da execução → executor
                                                        ↓
                                              MCP stdio persistente
                                              ou SDK nativo local
                                                        ↓
                                                  Cua Driver
                                                        ↓
                                              Chromium + desktop
```

O Lume deste repositório é o consumidor. “Lume” também é o nome de um produto de VMs no monorepo Cua; essa coincidência não cria dependência. `cua-agent`, `computer-server`, Sandbox e Fleet não são requisitos assumidos nesta proposta. O guia do Driver separa expressamente o controle do host da criação de desktops pelo Sandbox. [Guia de integração](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/docs/content/docs/how-to-guides/driver/connect-your-agent.mdx).

## Interfaces verificadas

| Interface | O que existe | Consequência para o serviço |
| --- | --- | --- |
| `cua-driver mcp` | Processo MCP por stdio; em Linux/Windows normalmente possui o runtime, salvo `--socket` explícito. | Bom ponto de integração para um executor que já possua cliente MCP. Manter a conexão durante a execução. |
| `@trycua/cua-driver` | SDK Node/TypeScript gerado por UniFFI sobre runtime Rust nativo. `CuaDriver.create()` roda no processo, sem daemon. | Alternativa para um worker Node; exige biblioteca nativa compatível com SO/arquitetura. Não é SDK browser/Edge puro. |
| `CuaDriver.createPrivateWorker()` | Runtime filho supervisionado por pipes herdados, sem listener ou reconexão. | Opção de separação de processo local; verificar presença na release escolhida. |
| `cua-driver serve` + `connect(socketPath)` | Daemon duradouro via IPC local: Unix socket ou named pipe autenticado para o mesmo usuário. | Compartilhamento de runtime é explícito; `connect` não significa URL remota genérica. |
| `cua-driver call` | Adaptador CLI de uma chamada conectado ao daemon. | Evitar como transporte principal de um fluxo com vários passos e estado. |

Fontes: [modelo de processos](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/docs/content/docs/reference/cua-driver/process-model.mdx), [SDK TypeScript](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/typescript/README.md).

O MCP stdio implementa a revisão `2026-07-28` e mantém negociação legada `2025-06-18`. A integração deve testar a versão efetiva do cliente do Lume. O pacote TypeScript não fornece uma segunda implementação MCP em JavaScript; esse protocolo pertence ao executável. [Protocolo](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/docs/mcp-protocol-and-skills.md), [SDK](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/typescript/README.md).

### HTTP não equivale a um gateway remoto pronto

- O endpoint MCP HTTP opcional escuta somente `127.0.0.1`, recebe `POST /mcp`, exige bearer configurado pelo host com 32–4096 caracteres e recusa requisições com `Origin`. Aceita somente MCP legado. O código declara SSE e cabeçalhos de sessão como trabalho posterior; o ciclo de vida atual pertence à conexão TCP. [Implementação HTTP](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/rust/crates/cua-driver/src/mcp_http.rs).
- Existe outro carrier HTTP privado com `/v1/connections`, `exchange`, `cancel` e `DELETE`. Ele também escuta apenas loopback, é desabilitado por padrão e **não autentica chamadas**. Sua documentação proíbe exposição direta e o descreve como contrato de implementação, não guia de implantação publicado. [Carrier privado](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/docs/private-envelope-http.md).
- A entrada opcional `/fleet` depende de uma conexão Fleet autenticada e de capacidades específicas anunciadas pelo guest. A documentação a chama de candidata e distingue testes sintéticos de qualificação real de imagem/release. Não é base comprovada para presumir suporte remoto universal. [Integração Fleet candidata](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/docs/shared-fleet-mcp-client.md).

**Recomendação:** nossa API autentica o serviço/usuário e agenda trabalho; o executor usa stdio ou SDK local. Não publicar nenhum desses listeners diretamente na Internet. Para executor no computador do usuário, estudar conexão de saída autenticada até nosso serviço como parte própria da arquitetura.

## Browser, Linux e containers

As ferramentas tipadas de browser usam **Chrome DevTools Protocol**, com comprovação de vínculo entre processo, janela nativa e página. A instalação de extensão Chrome não aparece como requisito dessa rota. Uma URL de DevTools arbitrária ou uma aba lembrada não substitui o vínculo exato. [Guia de browser](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/rust/Skills/cua-driver/BROWSER.md).

| Ambiente | Evidência relevante |
| --- | --- |
| Windows Chrome/Edge | Rota tipada e pointer CDP trusted em background validados; exige desktop interativo, não Session 0. |
| Linux X11 Chromium/Chrome/Edge | Há suporte a vínculo exato e ações DOM explícitas. Pointer trusted em Chromium standalone pode ser recusado porque ativaria a janela. |
| Linux Sway | Exige identidade exata de compositor/processo/janela/geometria. |
| Wayland genérico GNOME/KDE | Não presumir capacidade de mutação: descoberta pode ser somente leitura ou resultar em recusa. |
| Firefox/Safari | Sem mutação browser tipada; a alternativa é automação nativa com outros limites. |

Fonte da matriz e do caráter preview anterior à versão 1.0: [limitações oficiais](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/docs/content/docs/reference/cua-driver/limits.mdx).

O guia Linux exige display e aplicações em execução, cita `xfce4` sob `Xvfb` para servidores sem desktop e dependências como `libxi6`/AT-SPI. O projeto mantém CI com Xvfb/Openbox e Sway headless. Isso fundamenta um experimento com **Chromium headed em desktop virtual**, mas não comprova que uma imagem Docker arbitrária, Chrome `--headless` ou um serviço CDP existente funcionará sem adaptação. [Instalação](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/docs/content/docs/how-to-guides/driver/install.mdx), [validação Linux](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/docs/linux-desktop-validation.md).

**Hipótese para POC cloud:** uma unidade isolada por execução ativa contendo desktop X11 virtual, Chromium e executor. Confirmar a instalação que `browser_prepare` aceita: no Linux a descoberta sem PID usa executáveis de pacotes atestados, pertencentes a root e não graváveis por grupo/outros; escolher um executável pelo `PATH` não é suficiente. [Preparação oficial](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/rust/Skills/cua-driver/BROWSER.md).

## Estado, autenticação nos sites e permissões

Sessões do Driver organizam estado, referências e ciclo de vida; **não criam desktops isolados**. Chamadas anônimas na mesma conexão reutilizam sessão implícita; o TTL ocioso padrão é cinco minutos. Encerrar a conexão dispara limpeza. O host deve manter um controlador por desktop e não tratar rótulos públicos como credenciais. [Runtime](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/rust/Skills/cua-driver/RUNTIME.md), [modelo de processos](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/docs/content/docs/reference/cua-driver/process-model.mdx).

`browser_prepare` oferece `isolated_new` e `isolated_named`; o segundo permite perfil reutilizável gerenciado pelo Driver. Anexar perfil existente autenticado é uma fronteira de autorização própria. O projeto não promete menos CAPTCHAs e não instrui copiar perfis pessoais. Para o produto, persistência de cookies deve ser uma escolha por escritório/identidade, independente da duração de uma sessão do Driver. [Perfis](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/docs/content/docs/reference/cua-driver/browser-profile-attachment.mdx).

**Proposta:** usar `bounded` com ferramentas, origens e diretórios revisados pelo host, além de tempo máximo e ocioso. O modelo não deve poder alterar esse manifesto. O manifesto limita o runtime; não substitui isolamento de SO, rede ou tenant. [Modos de permissão](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/docs/content/docs/reference/cua-driver/permission-modes.mdx).

Há uma restrição decisiva: manifesto com `resources.browser.origins` **não pode** liberar ferramentas genéricas de input ou observação de janela/desktop, como `click`, `type_text`, `get_window_state`, `get_desktop_state` e `page`. A inicialização recusa essa combinação porque permitiria ignorar a origem. A descoberta inicial usa `list_windows`; a observação é `get_browser_state`. Logo, “tentar DOM e depois qualquer clique visual” não pode ser um fallback transparente sob essa mesma política. Handoff humano ou outra capacidade exige desenho explícito. [Manifesto de browser](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/docs/content/docs/how-to-guides/driver/write-a-bounded-manifest.mdx).

Referências de elementos pertencem à sessão, aba, documento e snapshot atual; navegação, reinício/reconexão e novos snapshots podem invalidá-las. **Proposta:** persistir objetivo, passos, evidências e estado de negócio; ao retomar, observar e vincular novamente. Não persistir refs como seletores duráveis nem repetir uma ação de efeito externo após timeout sem verificar seu resultado. [Browser](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/rust/Skills/cua-driver/BROWSER.md), [regra de resposta perdida](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/docs/mcp-protocol-and-skills.md).

## Arquivos, imagens e acompanhamento

Uploads tipados trabalham com arquivos locais absolutos; downloads usam raiz canônica do executor e devolvem identificador opaco/quantidade de bytes, sem caminho ou nome no retorno público. A autorização efetiva depende do modo/manifesto e do contrato publicado. **Proposta:** nosso serviço materializa entradas numa pasta por execução e publica saídas como artefatos autorizados; não deixar o agente inventar caminhos do host. A compatibilidade exata de download/aprovação deve fazer parte da POC. [Ferramentas browser](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/rust/Skills/cua-driver/BROWSER.md), [permissões de arquivo](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/docs/content/docs/reference/cua-driver/permission-modes.mdx).

`get_browser_state` pode retornar PNG da viewport da aba com métricas para converter pixels em coordenadas CSS. O recorder grava evidências locais e vídeo opcional; Linux X11 usa ffmpeg `x11grab`. O recorder é compartilhado dentro do runtime: sessões diferentes não garantem gravações concorrentes isoladas. [Browser](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/rust/Skills/cua-driver/BROWSER.md), [gravação](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/rust/Skills/cua-driver/RECORDING.md).

Não foi verificado um endpoint geral do Driver para transmitir desktop ao navegador do usuário com controle humano interativo. Não confundir PNGs, vídeo em arquivo ou o transporte MCP com WebRTC/noVNC. **Proposta:** começar com eventos e screenshots autorizados; avaliar um canal separado de visualização/handoff se o primeiro caso exigir login, MFA ou certificados. Isso é trabalho do serviço, não capacidade já confirmada do Driver.

## Pinning e critérios de prova

O repositório e o pacote Driver declaram MIT. Preservar os avisos aplicáveis na distribuição; dependências e imagens precisam de inventário próprio. [Licença](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/LICENSE.md), [pacote](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/typescript/package.json).

**Proposta de versionamento:** escolher release exata, guardar checksums dos artefatos e imagem por digest, fixar navegador e dependências do executor e atualizar somente após matriz de compatibilidade. Se usar SDK, biblioteca nativa e bindings devem acompanhar a mesma release; o projeto monta os pacotes Python/npm a partir dos mesmos artefatos Rust. Não usar `main`, `latest` ou nightly implicitamente em produção. [Empacotamento](https://github.com/trycua/cua/blob/d1a01f8580d5963702427b9e110fbcd98c39fac3/libs/cua-driver/README.md), [release/checksums](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.28.2).

Antes da decisão de implantação, a POC deve demonstrar:

1. Ambiente exato: browser iniciado, vínculo de janela, leitura, navegação, preenchimento, click DOM e recusas trusted esperadas.
2. Um caso real completo com autenticação, upload/download e evidência de conclusão.
3. Origem/diretório negado, separação entre escritórios e controle exclusivo de execução.
4. Cancelamento, reinício de executor e espera humana maior que o TTL sem repetir efeitos externos.
5. Perfis: novo login, reutilização autorizada e exclusão/revogação.
6. Se necessário, handoff humano e captura/gravação sob a política efetivamente permitida.

Esses itens são critérios propostos para o K5. A pesquisa não executou nenhum deles e não atribui ao ambiente local garantias obtidas apenas da documentação upstream.
