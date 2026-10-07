# Publicação na main

Autorizada pelo usuário em 7 de outubro de 2026. O usuário fará o deploy.

- `221b612`: refactor completo, migrações, testes e documentação. Os scripts de preparação e2e foram movidos para `e2e/support` e usam o ambiente do runner.
- `c2b403b`: atualização dos testes de conversa persistente, tema claro, delegação e restauração das configurações de IA.
- `f8951dd`: serialização JSON do mock com partes heterogêneas de mensagem.
- `13414d2`: seletores de atividade consideram o prefixo do módulo; a comparação de configuração mantém o estado, permitindo mudar a mensagem explicativa.

Todos os commits foram enviados para `origin/main`, sem force push. O repositório é público; anexos, logs e demais arquivos de `.audit` ficaram locais. O ambiente GitHub `production` exige aprovação de `araujodgdev`.

CI atual: https://github.com/araujodgdev/k5/actions/runs/37658235780

Lint, tipos, build Cloudflare e testes PostgreSQL passaram. O job e2e `112918787103` ainda instala o conversor de PDF. Nas rodadas anteriores, os downloads do repositório Ubuntu variaram bastante de velocidade. Não reiniciar somente pela demora.

A instância local `20261007T165940-c7eeda` foi encerrada pela skill após a máquina ficar com menos de 300 MB livres. A rodada local incompleta não conta como aprovação. Os últimos lint direcionado e `pnpm typecheck` passaram. Nenhuma aplicação foi publicada em produção por este trabalho.

Resultado final: CI 37658235780, tentativa 2, concluído com sucesso para 13414d25fe5f3b7ccafeb11d7a81cabc37207851. Deploy 37661287612 pendente de aprovação. HEAD e origin/main conferidos no mesmo commit. Nenhum processo de verificação local ficou ativo.
