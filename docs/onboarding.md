# Tutorial e primeiros passos

O primeiro acesso a uma pessoa/escritório neste navegador oferece o tour do Lume.
A pessoa escolhe Começar tutorial ou Agora não. O botão Tutorial no menu desktop e em
Mais no celular permite retomar, recomeçar ou assistir ao vídeo.

O tour navega pelas telas com Voltar e Próximo, destaca o controle apresentado e permite
sair com Escape. O foco fica dentro do diálogo; ao sair, volta ao acionador ou ao conteúdo.
O cartão se ajusta à tela e respeita redução de movimento. As etapas não escrevem dados.

O progresso fica em localStorage, na chave `lume:tutorial:v1:<userId>:<officeId>`.
Ele não é sincronizado entre dispositivos. Bloqueio de armazenamento não impede abrir o
tutorial manualmente. WhatsApp, Anúncios e Administração só entram no tour quando a sessão
tem acesso a essas áreas; a verificação de autorização no servidor permanece em cada rota.

As etapas estão em `apps/web/src/lib/onboarding.ts` e o diálogo em
`apps/web/src/components/onboarding-tour.tsx`. A página autenticada `/app/tutorial` apresenta
o vídeo com controles nativos, legendas e download. A produção do vídeo está documentada
em [apps/tutorials](../apps/tutorials/README.md).

## Verificação

Com o servidor local iniciado e a conta demo provisionada:

```sh
pnpm --filter @k5/web exec tsx scripts/verify-onboarding.ts --video
```

O script usa desktop e celular, percorre as etapas, volta, pausa, recarrega, retoma, confere
o foco por teclado e conclui. Capturas ficam em `apps/web/.data/tutorial/verification/`.
Também execute lint, typecheck, testes e build a partir da raiz.

## Reprodução na Cloudflare

O Worker atende somente o MP4 do tutorial antes da camada de assets para responder a
pedidos HTTP Range. Isso permite avançar e voltar no vídeo. As demais URLs mantêm o
roteamento habitual. `tests/tutorial-video.test.ts` cobre trechos, sufixos, limites,
validador de versão e cancelamento do fluxo após os bytes solicitados.
