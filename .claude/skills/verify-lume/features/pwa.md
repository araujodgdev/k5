# Instalação e funcionamento offline

Receita derivada do código para validação futura. Nenhum cenário desta revisão foi executado. ID estável: `pwa`.

## Sub-features

- `pwa-01`: Manifesto e ícones estão publicados e consistentes.
- `pwa-02`: Instalar Lume abre convite nativo ou instruções adequadas ao navegador.
- `pwa-03`: Tema escuro atualiza a cor da barra.
- `pwa-04`: Service worker existe no build de produção; modo offline apresenta o comportamento documentado sem expor dados privados.

## How to get to it (user POV)

- `/app/command-center`
- `/manifest.webmanifest`

## Driving it with e2e

Test: `apps/web/e2e/pwa.e2e.ts`

Preconditions: instância isolada saudável segundo `doctor`, contas descartáveis e dados do cenário. Preparar os resultados de [brand-shell](./brand-shell.md). Dependências adicionais de cenários: `production-build`. Consultar [o catálogo e o escopo das dependências](../coverage/README.md); elas não bloqueiam automaticamente os cenários locais.

1. Abra Instalar Lume no desktop e em 390px e siga o caminho disponível.
2. Inspecione manifesto/ícones e alterne o tema.
3. Em ambiente isolado com build, confirme service worker e teste offline conforme README.
4. Para cada subitem, registrar ação, estado anterior/posterior, evidência, desktop e 390px quando houver interface, acesso por teclado e persistência por recarga/leitura autenticada. Aplicar cenários negativos de autorização com outra conta.

## Gotchas

- pwa.e2e.ts pula a verificação do worker quando sw.js retorna 404 em dev. Não marcar offline aprovado por esse skip.
- Resultado verde de arquivo de teste não aprova automaticamente todos os subitens; separar mocks, preparação por API e fluxo real.
- Origem da receita: [apps/web/src/app/manifest.ts](../../../../apps/web/src/app/manifest.ts), [apps/web/e2e/pwa.e2e.ts](../../../../apps/web/e2e/pwa.e2e.ts).
- [Grafo, estados e prompt para o agente](../coverage/README.md).
