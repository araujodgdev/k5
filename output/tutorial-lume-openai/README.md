# Tutorial com narração OpenAI

Esta versão preserva as cenas e o conteúdo do tutorial anterior. A voz foi gerada por `gpt-4o-mini-tts`, com a voz `marin` e instruções de português brasileiro, dicção clara, tom didático, pausas curtas e pronúncia dos nomes da plataforma.

O vídeo mantém os cliques visíveis, os títulos e as legendas. A duração de cada trecho foi recalculada a partir do áudio, com ajuste de velocidade sem alteração de tom para respeitar o limite de cinco minutos.

- [Parâmetros e instruções completas](narracao.json)
- [Capítulos](capitulos.md)
- [Legendas SRT](tutorial-lume.pt-BR.srt)
- [Legendas VTT](tutorial-lume.pt-BR.vtt)

A chave foi lida do anexo em memória e enviada somente para a autenticação na API OpenAI. O roteiro e os metadados não contêm credenciais.

As limitações do ambiente gravado permanecem: WhatsApp com conexão pendente e Anúncios BETA não habilitado. Os exemplos de cadastro são fictícios e a lista de e-mails está desfocada.

O vídeo anterior continua em `output/tutorial-lume/`. Esta versão fica em `output/tutorial-lume-openai/`.

## Verificação desta versão

- Duração de 293,155 segundos (4min53s), 1920×1080, H.264, AAC 48 kHz, aproximadamente 15 MB.
- Decodificação completa pelo FFmpeg sem erros; áudio com pico de -2,9 dB, sem clipping.
- Reprodução e busca até dois minutos verificadas no Chromium em telas de 1440 e 390 pixels.
- `pnpm lint` passou com o aviso preexistente sobre `_bytes` em `judicial/connectors/transport.ts`.
- `pnpm typecheck` passou nos dois projetos.
- `pnpm test` encontrou falhas de conexão PostgreSQL e foi interrompido após 4min37s. Não houve aprovação da suíte geral nesta execução.
- MP4, VTT e capa atualizados em `apps/web/public/tutorial/`. Não houve novo deploy.
