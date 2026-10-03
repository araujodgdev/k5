# Tutorial e primeiros passos

O primeiro acesso a uma pessoa/escritório neste navegador oferece o tour do Lume.
A pessoa escolhe Começar tutorial ou Agora não. O botão Tutorial no menu desktop e em
Mais no celular permite retomar, recomeçar ou abrir os vídeos por módulo.

O tour navega pelas telas com Voltar e Próximo, destaca o controle apresentado e permite
sair com Escape. O foco fica dentro do diálogo; ao sair, volta ao acionador ou ao conteúdo.
O cartão se ajusta à tela e respeita redução de movimento. As etapas não escrevem dados.

O progresso fica em localStorage, na chave `lume:tutorial:v1:<userId>:<officeId>`.
Ele não é sincronizado entre dispositivos. Bloqueio de armazenamento não impede abrir o
tutorial manualmente. WhatsApp, Anúncios e Administração só entram no tour quando a sessão
tem acesso a essas áreas; a verificação de autorização no servidor permanece em cada rota.

As etapas estão em `apps/web/src/lib/onboarding.ts` e o diálogo em
`apps/web/src/components/onboarding-tour.tsx`. A página autenticada `/app/tutorial` apresenta
a biblioteca de vídeos organizada por módulo. Cada tutorial abre em `/app/tutorial/<videoId>`,
com controles nativos, legendas, duração e download próprios. Os filtros de módulo ficam na URL,
e o retorno do vídeo mantém o módulo selecionado. Administração aparece somente para quem
tem esse acesso na sessão. O catálogo compartilhado fica em `packages/tutorial-library/src/index.ts`;
`apps/web/public/tutorial/library.json` registra os vídeos publicados. A produção está documentada
em [apps/tutorials](../apps/tutorials/README.md).

## Verificação

`apps/web/e2e/onboarding.e2e.ts` usa desktop e celular, percorre as etapas, volta, pausa,
recarrega, retoma, confere o foco por teclado e conclui o tour. Também verifica a entrada na
biblioteca, filtros, acesso por teclado, páginas individuais, arquivos de cada
vídeo, módulo vazio, endereço desconhecido e falha de carregamento. Roda no CI com a
[suíte e2e](../apps/web/README.md#testes-end-to-end); para repeti-lo:

```sh
pnpm --filter @k5/web exec e2e run e2e/onboarding.e2e.ts
```
Também execute lint, typecheck, testes e build a partir da raiz.

## Reprodução na Cloudflare

O Worker atende os MP4s em `/tutorial/videos/<videoId>/video.mp4` antes da camada de assets para responder a
pedidos HTTP Range. Isso permite avançar e voltar no vídeo. As demais URLs mantêm o
roteamento habitual. `tests/tutorial-video.test.ts` cobre trechos, sufixos, limites,
validador de versão e cancelamento do fluxo após os bytes solicitados.
