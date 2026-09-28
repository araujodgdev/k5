# Verificação local do WhatsApp

Validação de 28/09/2026 sobre a implementação iniciada na base `357d0aa`, na branch `codex/whatsapp-zernio`.

A caixa de conversas, as rotas HTTP, a autenticação e o processamento de jobs rodaram com PostgreSQL real e build de produção. Zernio e Flagship usaram respostas controladas, fora do código da aplicação. Todas as conversas eram fictícias. Nenhuma mensagem foi enviada a uma pessoa ou a um aparelho real.

## Checagens executadas

| Checagem | Resultado |
| --- | --- |
| `pnpm typecheck` | Aprovada |
| `pnpm lint` | Sem erros. Um aviso preexistente em `judicial/connectors/transport.ts`, variável `_bytes` |
| `pnpm test` | 559 testes aprovados, zero falhas e zero testes ignorados |
| `pnpm build` | Build Next.js aprovado |
| `pnpm integrations:build` | Bundle do Worker de integrações aprovado, sem deploy |
| `pnpm --filter @k5/web build:vinext` | Bundle web Cloudflare e Durable Object do chat aprovados, sem deploy |

Os testes WhatsApp cobrem isolamento entre escritórios, sessão e papel revogados, flag desligada, callback de uso único, criação incerta de chave, HMAC, duplicação de eventos, edições, exclusões, datas futuras, cursores, leases e mudança de geração. Os testes de envio exercitam concorrência, intenção idempotente, resposta ambígua e aprovação vinculada ao texto e destinatário em chamadas Mastra e WebMCP.

## Navegador

A verificação com `control-ui` usou a aplicação na porta 3002 e banco isolado na porta 55448. A caixa foi conferida em 1280 × 720 e 390 × 844 CSS pixels.

- Login com Better Auth e sessão real de teste.
- Consulta de conversa e identificação de resposta originada no aplicativo WhatsApp Business, informada pela fixture.
- Composição e envio de texto, recibo persistido e atualização do histórico.
- Resposta bloqueada após 24 horas e paginação de 30 para 60 mensagens locais.
- Metadados do anexo e orientação para abrir no aplicativo.
- Rascunhos separados por contato, foco no título ao abrir e retorno à lista pelo botão mobile.
- Resultado incerto mantém o aviso e bloqueia o compositor naquela tentativa. Consultar o resultado preservou três chamadas de envio no log do provedor, sem uma quarta chamada.
- Flag desligada removeu o acesso à caixa. O ambiente foi restaurado em seguida.
- Diálogo de desconexão cancelado pelo teclado, sem desconectar a conta.
- Nenhum erro de console nos fluxos finais. O celular apresentou `scrollWidth = innerWidth = 390`.

O contraste do horário e da prévia durante o hover foi corrigido e conferido no navegador. A captura precisou normalizar a escala de pixels da automação no Windows. Isso não alterou o CSS da aplicação.

O vídeo é uma gravação CDP de 47,204 segundos, com 134 quadros recebidos e seus tempos originais. O MP4 foi decodificado integralmente e seus quadros foram inspecionados. As capturas e o vídeo estão nos artefatos locais da conversa Codex, no diretório `whatsapp/verification`.

## Desempenho medido

Trinta amostras por operação, após três leituras de aquecimento. A leitura usou uma conversa com dez mil mensagens sintéticas. O webhook HTTP validou HMAC e gravou no PostgreSQL; o worker residente projetou os eventos.

| Operação | p95 |
| --- | --- |
| Ler 50 mensagens locais | 21,95 ms |
| Aceitar webhook | 10,93 ms |
| ACK até projeção observada | 983,91 ms |

Essas medidas não incluem a latência dos serviços externos. Não houve comparação com uma base equivalente da branch principal nem teste de carga distribuída. Elas não comprovam capacidade para uma quantidade específica de escritórios.

## Limites da entrega

A entrega reúne as quatro unidades funcionais do plano em um PR integrado. Não houve quatro PRs verificados isoladamente nem execução das dez faixas por PR previstas no plano. A evidência acima pertence à implementação final integrada.

Antes de liberar um número real, é necessário homologar o onboarding, a elegibilidade de coexistência, o reflexo das mensagens nas duas interfaces e a equivalência dos IDs REST/webhook. O catálogo autenticado do MCP remoto da Zernio não foi conectado. A implementação usa o adaptador REST.

Não havia conexão de IA configurada para verificar uma conversa com modelo real. Os testes executaram os serviços e a confirmação humana das ferramentas, mas não houve validação do streaming de um LLM. O navegador de validação não disponibilizou ferramentas WebMCP registradas; o catálogo e o adaptador foram verificados pela suíte automatizada.

Nenhum recurso Cloudflare foi provisionado ou publicado. A avaliação real do Flagship e o consumo da fila hospedada permanecem parte da homologação de staging. Veja [configuração e operação](integracao-whatsapp.md).
