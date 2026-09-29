# Mapa de verificação do K5

Leia a [skill](../SKILL.md) para iniciar a instância, rodar o diagnóstico e preservar as evidências. Este é o mapa da versão em `.cursor`; os scripts compartilhados continuam em `.claude`.

## Condições iniciais

A conta retornada por `up` é administradora de `Escritório de Verificação`. O banco começa vazio e persiste até `down`. Faça login pela tela, reutilize essa conta durante o teste e use títulos únicos. A instância não tem workers ou integrações configuradas. Não use o servidor de outro trabalho ou uma conta real para estas receitas.

## Funcionalidades

| ID | Receita | Automação disponível |
| --- | --- | --- |
| `authentication` | [Cadastro, entrada e saída](authentication.md) | Login exercitado pelo driver de tarefas; demais cenários têm receita |
| `office-tasks` | [Tarefas do escritório](office-tasks.md) | `Invoke-K5Verify drive office-tasks`; acesso direto, criação, persistência, conclusão e largura móvel |
| `office-clients` | [Clientes](office-clients.md) | Receita com seletores do código; sem driver |
| `vault-cases` | [Casos do Cofre](vault-cases.md) | Receita com seletores do código; sem driver |

O mapa inicial não cobre todo o produto. Chat/IA, documentos, Pesquisa, Google, pagamentos, colaboração e notificações precisam de receitas próprias e das respectivas dependências. Ausência de chaves é uma condição não atendida, não prova de sucesso ou defeito da integração.

## Como registrar a prova

Use `shot()` para capturas, `log()` para ação/resultado e `close()` em `finally` para a trace. Registre ID, caminho de entrada, largura, resultado esperado e observado. Guarde a leitura de persistência junto da evidência visual. Aguarde estados como `aria-busy="false"` e o fechamento do diálogo.

Um caminho direto por URL não comprova cliques na navegação. Declare cada entrada como executada, não executada ou bloqueada com motivo. As receitas abaixo descrevem o que comprovar; só o registro de uma execução permite marcar um item como aprovado. Revise teclado, estados vazios, carregamento e falha quando forem afetados pela alteração.

Cada arquivo mantém quatro seções: `Sub-features`, `How to get to it (user POV)`, `Driving it with Playwright (session.mts)` e `Gotchas`. Atualize a receita quando os seletores ou o comportamento mudarem.
