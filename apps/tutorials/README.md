# Tutoriais do Lume

Biblioteca de vídeos em português, composta no Remotion a partir de gravações reais do navegador.
Cada vídeo tem títulos, cliques destacados, legendas na imagem, arquivos SRT/VTT e narração pt-BR.

O catálogo em `packages/tutorial-library/src/index.ts` organiza módulos e vídeos. Cada vídeo tem
ID estável, título, descrição e capítulos de origem. Um módulo pode ter vários vídeos.
O aplicativo mostra os vídeos publicados em `apps/web/public/tutorial/library.json`, permite
filtrar módulos e abre cada tutorial em `/app/tutorial/<videoId>`.

## Atualizar um vídeo

Na raiz, regrave somente o capítulo que mudou e gere o vídeo correspondente:

```sh
pnpm --filter @k5/web exec tsx scripts/tutorial-account.ts
pnpm --filter @k5/web exec tsx scripts/record-tutorial.ts --only=02-clientes --force
pnpm --filter @k5/tutorials render -- --only=clientes --openai --publish
```

`--only` do gravador recebe IDs de capítulos; `--only` do render recebe IDs de vídeos do catálogo.
Use aspas para vários IDs no PowerShell, como `'--only=clientes,tarefas-e-agenda'`.
Um ID desconhecido interrompe o render antes de alterar a publicação.

O áudio tem cache próprio por vídeo e trecho. Atualizar um vídeo preserva os arquivos,
áudios e entradas dos demais. As URLs recebem uma revisão por conteúdo para o navegador
carregar os arquivos atualizados.

Para adicionar um tutorial, acrescente a gravação em `apps/web/scripts/record-tutorial.ts`,
registre o vídeo no módulo correspondente do catálogo e execute os comandos com os novos IDs.
Sem `--only`, o render processa todos os vídeos cadastrados.

`--publish` copia MP4, VTT e capa para `apps/web/public/tutorial/videos/<videoId>/` e atualiza
somente a entrada desse vídeo no índice. Revise e inclua esses arquivos no deploy habitual.
O comando não faz deploy. Sem `--publish`, o resultado fica apenas em
`output/tutorial-library/<videoId>/`, com `video.mp4`, SRT, VTT, capa e roteiro JSON.

## Gravações e ambiente

A gravação reutiliza a conta local `demo.tutorial@lume.test`. A senha aleatória e a sessão
ficam em `apps/web/.data/tutorial/`, fora do Git. Cadastro e login passam pelo Better Auth.
Clientes, casos, atividades e honorários pertencem ao escritório demonstrativo.

Os trechos de IA, Pesquisa, Google, WhatsApp e Administração usam uma sessão autenticada
no ambiente publicado, autorizada pelo responsável. A sessão fica no arquivo privado
`apps/web/.data/tutorial/deploy-session.json`. Não há senha de implantação nos scripts.
A conexão Google demonstrada é real; a lista de mensagens é desfocada. O exemplo de e-mail
é fechado sem envio. O destinatário de Mensagens é outra conta fictícia local.

Os capítulos em `public/recordings/` são reutilizados. `--force` substitui o capítulo selecionado;
regravar um cadastro pode criar outro registro demonstrativo. Confira os dados antes de executar.
Os vídeos importados preservam as telas da gravação anterior. Mudanças na interface ou no
modelo de colaboração exigem regravar e revisar os capítulos afetados antes de atualizá-los.

## Narração e montagem

O render exige `ffmpeg` e `ffprobe` no PATH. Sem `--openai`, usa uma voz pt-BR instalada no Windows.
Com `--openai`, usa `gpt-4o-mini-tts`, voz `marin`, e as instruções de português brasileiro em
`scripts/narrate-openai.ts`. Configure `OPENAI_API_KEY` ou `OPENAI_API_KEY_FILE` com uma única chave
`sk-proj-`. A chave é lida em memória e não entra no roteiro ou nos logs.
O cache existente pode ser reutilizado sem chave; novas falas exigem a chave da API.

As gravações são convertidas para H.264 com quadros-chave frequentes. O Remotion produz as
camadas de títulos e legendas; o FFmpeg combina essas camadas com vídeo e narração por trecho.
Isso evita falhas de decodificação do compositor em máquinas com pouca memória.
A duração acompanha o roteiro de cada vídeo; não há limite global de duração da biblioteca.
`--prepare` gera roteiro e áudio sem renderizar ou publicar:

```sh
pnpm --filter @k5/tutorials render -- --only=clientes --openai --prepare
pnpm --filter @k5/tutorials exec remotion studio src/index.tsx --props ../../output/tutorial-library/clientes/roteiro.json
```

Cada pasta de vídeo inclui `narracao.json` com os parâmetros da voz OpenAI.
O vídeo identifica a narração como gerada por IA.

## Importação do tutorial anterior

A biblioteca inicial reaproveita os trechos finalizados e a voz OpenAI do vídeo anterior.
As legendas reiniciam em zero para cada tutorial. Para repetir essa importação na máquina
que preserva `output/tutorial-lume-openai/roteiro.json`, `parts/` e os áudios originais:

```sh
pnpm --filter @k5/tutorials render -- --from-existing --publish
```

Essa importação não chama a API nem recompõe as cenas. Também aceita `--only=clientes`.
Os arquivos anteriores ficam em `output/` como material de origem; a interface usa vídeos independentes.

Referências: [TTS OpenAI](https://developers.openai.com/api/docs/guides/text-to-speech),
[Remotion](https://www.remotion.dev/docs), [vídeo gravado](https://www.remotion.dev/docs/offthreadvideo).
