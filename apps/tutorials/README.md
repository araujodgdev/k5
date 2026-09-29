# Tutorial do Lume

Vídeo único em português, composto no Remotion a partir de gravações reais do navegador.
O material inclui títulos por módulo, cursor com indicação de clique, legendas gravadas
na imagem, arquivos SRT/VTT e narração sintetizada em pt-BR.

Na raiz do repositório:

```sh
pnpm --filter @k5/web exec tsx scripts/tutorial-account.ts
pnpm --filter @k5/web exec tsx scripts/record-tutorial.ts
pnpm --filter @k5/tutorials render
pnpm --filter @k5/tutorials studio
```

A gravação reutiliza a conta local `demo.tutorial@lume.test`. A senha aleatória e a sessão
ficam em `apps/web/.data/tutorial/`, fora do Git. O cadastro e o login passam pelo Better Auth.
Os dados de cliente, caso, atividade e honorários pertencem ao escritório demonstrativo.

Os trechos de IA, Pesquisa, Google, WhatsApp e Administração usam uma sessão autenticada
no ambiente publicado, autorizada pelo responsável. A sessão fica no arquivo privado
`apps/web/.data/tutorial/deploy-session.json`. Não há senha de implantação nos scripts.
A conexão Google demonstrada é real; a lista de mensagens é desfocada. O exemplo de e-mail
é fechado sem envio. O destinatário de Mensagens é outra conta fictícia local.

Os capítulos concluídos ficam em `public/recordings/` e são reutilizados nas próximas execuções.
Para substituir um trecho, use `--only=01-inicio --force`. A opção com vários capítulos precisa
de aspas no PowerShell, por exemplo `'--only=01-inicio,09-mensagens'`.
Regravar um cadastro pode criar outro registro demonstrativo; confira os dados antes de usar `--force`.

O render exige Windows com uma voz pt-BR instalada e `ffmpeg`/`ffprobe` no PATH. As gravações
são convertidas para H.264 com quadros-chave frequentes. O Remotion exporta as camadas de
títulos e legendas; o FFmpeg combina essas camadas com as gravações em movimento e a narração,
medida por trecho. Isso evita falhas de decodificação do compositor em máquinas com pouca memória.
As versões dos pacotes Remotion estão fixadas e alinhadas. O resultado fica em
`output/tutorial-lume/`, com MP4, SRT, VTT e roteiro JSON. O script recusa durações fora de
dois a cinco minutos. `render -- --prepare` gera roteiro e áudio sem renderizar o MP4.

Copie o MP4 e o VTT para `apps/web/public/tutorial/` para servir a página `/app/tutorial`.
A capa fica em `apps/web/public/tutorial/capa.jpg`.

## Narração OpenAI

Com `OPENAI_API_KEY` no ambiente, execute na raiz:

```sh
pnpm --filter @k5/tutorials render -- --openai
```

Também é possível indicar um arquivo privado com uma única chave `sk-proj-` usando
`OPENAI_API_KEY_FILE`. O script lê a chave em memória e não a inclui no roteiro ou nos logs.
Não coloque o arquivo de credenciais em `public/`.

A versão OpenAI usa exatamente `gpt-4o-mini-tts`, voz `marin` e instruções em português
brasileiro para dicção, ritmo, pausas e pronúncia. As instruções estão em
`scripts/narrate-openai.ts`. O áudio de cada trecho é reutilizado quando texto e parâmetros
não mudam, evitando novas chamadas pagas durante ajustes da montagem.
O resultado fica em `output/tutorial-lume-openai/`, incluindo `narracao.json` com os parâmetros.
Essa opção exige `ffmpeg`/`ffprobe`, mas dispensa a voz instalada do Windows.
Para abrir essa versão no Studio, execute
`pnpm --filter @k5/tutorials exec remotion studio src/index.tsx --props ../../output/tutorial-lume-openai/roteiro.json`.

O vídeo identifica a narração como gerada por IA. Referência:
[TTS da OpenAI](https://developers.openai.com/api/docs/guides/text-to-speech).

Referências usadas: [instalação](https://www.remotion.dev/docs),
[vídeo gravado](https://www.remotion.dev/docs/offthreadvideo),
[renderização](https://www.remotion.dev/docs/cli/render).
