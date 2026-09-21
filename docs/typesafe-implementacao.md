# TypeSafe no K5 — implementação e operação

Implementação do [plano integrado](plano-typesafe-k5.md), com a
[skill TypeSafe](../.agents/skills/typesafe-ai/SKILL.md). SDK fixado em `0.6.0`, modelo
inicial `jev-1.13.0`; perguntas versionadas no código. Jev fornece julgamentos tipados,
enquanto os modelos generativos existentes continuam responsáveis por redação e chat.

## Configuração por escritório

1. Execute `pnpm db:setup` para aplicar `0013_typesafe.sql`, preservando os dados atuais.
2. Um administrador da plataforma cadastra a chave em **Clientes → Gerenciar IA → TypeSafe**.
3. Salve e teste a conexão. O teste usa uma frase sintética, respeita o orçamento e pode
   consumir tokens. A chave é cifrada com AES-256-GCM e integra a rotação da chave mestra.
4. Escolha separadamente o modo de Cofre, Documentos e Agenda. Todos começam desligados.
5. Execute `pnpm worker` para processar a verificação de documentos.

`shadow` (avaliar sem aplicar) envia conteúdo e consome tokens, mas preserva o ranking,
oculta julgamentos documentais e mantém a Agenda para preenchimento manual. `enabled`
aplica a frente escolhida. Desligar uma frente funciona como rollback operacional, sem
apagar documentos, sugestões ou resultados anteriores. Remover a credencial desativa
a conexão. Uma falha de autenticação também a desativa; salve a chave corrigida para retomar.

A configuração padrão reserva até 500.000 tokens/dia UTC e quatro chamadas simultâneas.
A reserva é conservadora (bytes UTF-8, perguntas e margem de resposta), não uma previsão
de faturamento. Tentativas continuam reservadas após timeout. Uso retornado pelo serviço,
duração, versão, hash e status ficam em `typesafe_evaluation`; prompts e respostas brutas
não ficam nessa tabela. Três falhas consecutivas abrem o circuito por 30 segundos.
Não há retries do SDK. Limites por chamada: RAG 2 s, Agenda 5 s, Documentos 10 s.

## Comportamento entregue

- **Cofre/RAG:** recupera candidatos pelo caminho híbrido existente, preserva escritório,
  filtros e referências, revalida conteúdo/permissões e reordena até 24 candidatos.
  Lote incompleto, limite ou indisponibilidade preservam a ordenação anterior. A redação
  de minutas usa essa mesma recuperação; a cronologia continua cobrindo todos os trechos.
- **Documentos:** mantém verificações literais e acrescenta suporte, contradição,
  insuficiência de evidência e contexto. A fila processa quatro unidades por checkpoint,
  revalida lease, acesso, versão do artefato e snapshot das fontes. Resultados antigos
  ficam desatualizados após edição ou alteração/exclusão da fonte. Nenhum resultado muda
  o documento para aprovado. A cobertura indica unidades processadas, não validação jurídica
  de todo o documento. Parágrafos editados sem vínculo exato não herdam citações anteriores.
- **Agenda:** interpreta a mensagem em uma proposta privada, com referência temporal e
  fuso. A pessoa revisa os campos e confirma a gravação. Modelos e WebMCP não recebem as
  capacidades de criar, alterar ou confirmar atividades diretamente. Confirmação usa
  permissões atuais, versão do alvo e recibo atômico junto à atividade, tolerando retries.
  Propostas expiram em 24 horas. CRUD manual continua disponível.

Na Agenda, datas civis, conversão para UTC e validação de intervalo ficam no código.
Fuso ausente, data incompleta, horário local inexistente/duplicado e reunião sem fim
pedem correção. A descoberta automática considera até 101 registros por grupo e oferece
até 20 candidatos; a interface permite refinar a busca de atividades. Casos fora desse
recorte precisam de seleção manual. O limiar de confiança de 0,8 só impede preenchimento
incerto: é uma heurística inicial, ainda não calibrada, e nunca autoriza uma gravação.

## Avaliação real controlada — 21/09/2026

O corpus em `apps/web/tests/fixtures/typesafe-corpus.ts` contém 60 consultas RAG,
120 unidades documentais e 80 pedidos de Agenda, todos sintéticos. A execução usa banco
em memória e chave fornecida apenas ao processo de teste. Nenhum documento do escritório
foi usado nessa avaliação. Resultado do lote completo: 170 chamadas, 302.331 tokens de
entrada e 41.379 de saída (sem contar smoke tests e teste de conexão).

| Frente | Resultado | Latência p95 observada |
| --- | --- | --- |
| RAG, 60 consultas | nDCG@8: 0,7078 → 0,9997; Recall@8: 1,0 → 1,0; reranking aplicado em 60/60 | 387 ms |
| Documentos, 120 unidades | 117/120 concordâncias com rótulos; nenhum falso suporte nessa amostra | 331 ms por lote de até 4 unidades |
| Agenda, 80 mensagens | 79/80 intenções esperadas; uma abstenção por confiança | 355 ms |

Limitações: baseline RAG lexical, sem embedding configurado; famílias repetem estrutura;
os rótulos foram preparados na implementação, sem revisão humana independente. A Agenda
repete templates entre os splits, portanto seu resultado não mede generalização. O teste
de Agenda mede intenção, não acurácia de todo o payload. Estes números validam a integração
e não justificam ativação automática em produção.

Três divergências documentais (`document-2-1`, `document-2-4`, `document-2-7`) classificaram
como **sem suporte** uma atribuição de assinatura a Bruno quando a fonte cita Ana. O rótulo
esperado era **contradição**, mas a fonte não exclui outro signatário: essa rubrica precisa
de revisão humana, sem alterar rótulos para melhorar a métrica. `agenda-3-1` absteve-se de
classificar a conclusão de tarefa. Nenhum prompt foi ajustado em função desses resultados.

Para repetir com uma chave guardada em arquivo local ignorado, a partir da raiz:

```powershell
$env:TYPESAFE_EVAL_KEY_FILE = (Resolve-Path 'apps/web/.data/sua-chave-de-teste').Path
pnpm --filter @k5/web typesafe:eval --limit 1
# Sem --limit executa o corpus completo. Há custos reais do fornecedor.
```

O relatório detalhado é gravado em `apps/web/.data/typesafe-eval.json` (ignorado pelo Git).
`TYPESAFE_API_KEY` é alternativa apenas para esse script. Não coloque a chave em argumentos,
commits ou documentação. Antes de um piloto com documentos reais, concluir avaliação pt-BR
independente, revisar tratamento/retenção do fornecedor e calibrar critérios por escritório.

## Validação de engenharia

- `pnpm db:setup`, `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build`.
- 178 testes: isolamento, papéis, cifra/rotação, limites concorrentes, timeout, circuito,
  fallback por lote, confirmação concorrente, rollback do recibo, referências externas,
  conflitos de versão, DST, checkpoints, lease e revogação durante a verificação.
- Build `pnpm --filter @k5/web build:vinext` para o alvo Cloudflare.
- Playwright em produção local: revisão antes de gravar, recibo após confirmação,
  configuração cifrada/teste real/remoção de chave, layouts 1440×1000 e 390×844,
  ausência de overflow horizontal, foco preso no diálogo e fechamento por Escape.
- Editor com fixture sintética determinística: evidência expandida, mudanças não salvas,
  revisão desatualizada e erro de integração desativada. Esse teste de UI não substitui
  os testes do worker nem representa geração documental real de ponta a ponta.

Os builds apresentam avisos do projeto/dependências (tracing de storage no Next,
chunks grandes e `eval` de gray-matter no vinext), sem falha de compilação.
Não houve deploy nem migração remota D1. Antes de publicar, validar as migrações e o
SDK no runtime de destino com dados sintéticos, além de revisar o PR.
