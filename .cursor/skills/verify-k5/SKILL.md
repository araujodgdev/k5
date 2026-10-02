---
name: verify-k5
description: Verifica a interface web do K5 (Lume) em uma instância local isolada, rodando os testes e2e de apps/web/e2e contra PostgreSQL real e guardando as evidências. Use para comprovar telas, formulários, rotas ou dados do escritório depois de uma alteração em apps/web.
---

# Verificar K5

A skill completa, com o CLI, o mapa de funcionalidades e os padrões de prova, fica em [`.claude/skills/verify-k5/SKILL.md`](../../../.claude/skills/verify-k5/SKILL.md). Leia-a antes de começar; esta cópia só existe para o Cursor encontrá-la.

Resumo, a partir da raiz do repositório:

```sh
K="pnpm --silent --dir apps/web exec tsx ../../.claude/skills/verify-k5/scripts/k5-verify.mts"
$K up                 # instância isolada: PostgreSQL embutido, next dev em porta livre e conta de verificação
$K doctor             # confira antes de dirigir
$K features           # funcionalidades e os testes e2e de cada uma
$K drive <id>         # roda os testes da funcionalidade contra a instância
$K down               # encerra; as evidências ficam em apps/web/.e2e/verify/<runId>/
```

Para escrever um teste novo, use a skill `e2e` em [`.agents/skills/e2e`](../../../.agents/skills/e2e/SKILL.md) e siga os arquivos em `apps/web/e2e/`.
