# Avaliação humana dos resultados do piloto

Página autenticada: `/app/feedback`, em **Avaliar respostas** na barra lateral
e em **Mais** no celular. Painel da plataforma: `/platform/feedback`.

O piloto usa os trabalhos reais de Mercury 2.5, DeepSeek V4.1 Flash e Muse Spark 1.3, executados
em 21/09/2026, na tarefa `corporate-ma/review-data-room-red-flag-review` do
[Harvey LAB](https://github.com/harveyai/harvey-labs), commit
`1dd81403b2fbb60596f7aea3fcecafad7bf73143`. São 13 documentos sintéticos em inglês,
um memorando DOCX e uma planilha XLSX por modelo. A licença MIT de Harvey AI
acompanha os dados importados e o ZIP das fontes.

| Modelo | Tempo total | Turnos | Tokens de entrada | Tokens de saída |
| --- | ---: | ---: | ---: | ---: |
| Mercury 2.5 | 101,43 s | 14 | 1.051.953 | 9.880 |
| DeepSeek V4.1 Flash | 410,79 s | 33 | 4.065.359 | 69.802 |
| Muse Spark 1.3 | 923,79 s | 45 | 6.133.655 | 70.025 |

As três execuções encerraram com `finish_tool`. Os manifestos confirmam hashes
iguais para a tarefa e os 13 documentos. Muse usa o tier standard, esforço `high`
e temperatura 1; todos têm limite de 200 turnos e 65.536 tokens por chamada.
Essas métricas são de uma única execução por modelo, sem juízes automáticos.

## Experiência

O usuário lê as prévias, pode baixar os arquivos originais e consultar a tarefa
e as fontes. A prévia preserva o conteúdo, mas não a diagramação do Word/Excel.
Notas de 1 a 5 cobrem clareza, precisão, completude e utilidade. Cada critério
admite **Não avaliei**, excluído da média. Há comentários por resposta e sobre
a escolha final, com opções de A, B, empate, nenhuma ou indecisão.

Os nomes e as métricas ficam no servidor até o envio. A ordem A/B é distribuída
por hash de campanha, escritório e usuário, estável entre visitas. Isso reduz
viés de posição; não garante grupos de tamanhos idênticos. Downloads usam nomes
neutros; os seis arquivos originais foram verificados quanto a referências
explícitas aos provedores nos XML internos.

Um voto por usuário/escritório/campanha, imutável após a revelação. A restrição
única no banco evita duplicatas concorrentes; repetir o envio recupera o voto
original. A campanha inclui um hash dos resultados importados, permitindo
identificar a versão exata avaliada. Tempos e tokens são mostrados após o voto.
Os tempos incluem ferramentas e API; entrada inclui histórico reenviado.

## Acesso e dados

A migração `0014_model_feedback.sql` cria `model_feedback`, compatível com a
abstração SQLite/D1 existente. Aplique `pnpm db:setup` no ambiente local; em
produção, aplique a nova migração pelo fluxo de deploy do ambiente.

Usuário e escritório vêm da sessão (`requireWorkspace` via `apiWorkspace` nas
APIs). A associação ao escritório e seu papel são revalidados no serviço.
Todos os três papéis podem enviar **seu próprio feedback**, incluindo revisor;
isso não amplia suas permissões sobre documentos ou outros dados de negócio.
Corpos são limitados e validados; gravações exigem mesma origem. Downloads e
respostas da API são privados e não armazenáveis em cache.

A pessoa vê somente seu voto. Administradores da plataforma podem consultar
preferências, notas, comentários, nomes e escritórios e exportar JSON por
`/api/platform/feedback`; ser administrador do escritório não concede esse
acesso. A interface informa essa visibilidade antes do envio. Administradores
com acesso ao painel podem conhecer os modelos previamente: seus votos não
devem ser tratados como cegos em análises de pesquisa sem controlar esse fator.

Preferência é armazenada tanto como A/B quanto como modelo real, junto da
ordem apresentada. O JSON exportado mantém votos individuais e notas nulas.
Esses dados não substituem os juízes oficiais nem permitem inferir um ranking
geral a partir de uma única tarefa. Nenhuma API de LLM é chamada nesta página.

## Importação e validação

### Base para curadoria e treinamento

A migração `0015_feedback_dataset.sql` adiciona consentimento opcional (desmarcado
por padrão), versão da rubrica e possível exposição prévia. Votos antigos não
recebem consentimento retroativo. Participação em outra rodada ou acesso de
administrador da plataforma marca possível exposição; isso não detecta conhecimento
obtido fora do Lume. O consentimento é registrado com o voto e permanece imutável.

`/api/platform/feedback?format=dataset` exporta `k5.feedback-dataset.v1`: tarefa,
ZIP das fontes, arquivos originais, hashes, métricas, parâmetros da execução e
avaliações autorizadas. Identificadores de pessoas são pseudonimizados; nomes e
escritórios são omitidos. Comentários livres ainda precisam de revisão de dados
pessoais. A exportação é restrita à administração e não é publicada.

Preferências decisivas geram referências `chosen`/`rejected` para os dois trabalhos
efetivamente avaliados. Empates, rejeição de ambos e indecisão continuam como tais.
Notas ausentes permanecem nulas. Não há voto agregado que apague desacordos.
O campo `splitGroup` agrupa pela tarefa; nunca dividir votos dos mesmos trabalhos
entre treino e teste. Este piloto tem uma tarefa, insuficiente para medir
generalização em um conjunto de teste independente.

Esta é uma base de **avaliação e curadoria**, não um JSONL pronto para um trainer.
SFT exige revisão especializada e uma resposta corrigida/aprovada: os campos SFT
permanecem pendentes e nenhuma preferência a aprova automaticamente. O piloto
produz arquivos; prévias de Word/Excel não substituem uma trajetória de agente.
O prompt de sistema não foi persistido pelo harness original e é declarado ausente.
Não há ainda editor de curadoria SFT, exportação de exemplos aprovados ou treinamento.

Saídas Meta e Inception são marcadas `evaluation_only` até revisão das condições
contratuais para o destino pretendido; DeepSeek fica `pending_review` para direitos
das fontes e privacidade. Isso vale também para o lado `rejected` dos pares.
Veja [a pesquisa de fontes primárias](feedback-training-research.md).

### Entrada de um terceiro modelo

O importador aceita um terceiro argumento opcional: diretório da execução concluída
do Muse Spark 1.3. Exige `finish_tool` e os dois arquivos; não cria resultados fictícios.
Arquiva a campanha anterior em `feedback-history.json` e cria outra com hash dos
novos resultados. Os votos antigos continuam no banco. A exportação administrativa
`/api/platform/feedback?history=1` inclui todas as rodadas arquivadas.

Com três candidatos, cada usuário recebe um dos três pares, com ordem A/B estável
por hash. A amostragem distribui pares e posições, sem garantir contagens idênticas.
O painel mostra quantas comparações cada modelo recebeu, além de preferências.
Não inferimos preferências sobre o terceiro candidato que a pessoa não viu.
Os links dos trabalhos incluem a rodada: páginas antigas não podem baixar outros
trabalhos por engano nem gravar votos na rodada nova; é necessário recarregar.

`apps/web/src/data/feedback-pilot.json` contém apenas a tarefa sintética, suas
fontes, as prévias, métricas e arquivos do piloto; é importado por módulo
`server-only`. Nenhuma credencial ou transcrição interna foi importada.

Para reproduzir a importação, execute `apps/web/scripts/import-feedback-pilot.py`
com Python + openpyxl, passando o caminho do checkout Harvey e do Pandoc. O
script é específico deste piloto e não é necessário no runtime. Novas campanhas
exigem preservar os dados históricos; não substituir o piloto sem arquivá-lo.

Validações: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
O teste de navegador usa a conta local estável já existente:

```sh
pnpm --filter @k5/web start
pnpm --filter @k5/web exec tsx scripts/verify-feedback.ts
```

O script aceita `FEEDBACK_TEST_EMAIL`, `FEEDBACK_TEST_PASSWORD` e `BASE_URL`
local. Recusa sobrescrever um voto preexistente e apaga somente o voto que ele
mesmo criou. Capturas ficam em `apps/web/playwright-report/feedback/`, ignoradas
pelo Git. O fluxo verifica desktop/celular, tema escuro, teclado, sigilo A/B,
downloads, origem, falha de rede com formulário preservado, persistência,
revelação e exportação administrativa.
