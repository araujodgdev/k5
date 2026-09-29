# Casos do Cofre

Uma pessoa cria um caso para organizar um assunto do escritório, informa descrição e dados opcionais de cliente e abre a página desse caso.

## Sub-features

- `cases-empty`: mostrar o estado inicial sem casos.
- `cases-create`: cadastrar título e descrição.
- `cases-cancel`: fechar um formulário sem criar registro.
- `cases-open`: abrir o caso salvo e confirmar o título após recarregar.
- `cases-view`: alternar cartões e lista.

## How to get to it (user POV)

- Menu desktop ou aba móvel `Cofre`, em `/app/vault`.
- Botão `Novo caso` do Cofre.
- Link do caso em cartões ou em lista.
- Link de caso no resumo do Início, em `/app/command-center`.

## Driving it with Playwright (session.mts)

Preconditions:

- `doctor` saudável; conta administradora; título único com pelo menos dois caracteres.
- Para estado vazio, use a instância antes de cadastrar casos.

- Abra `page.goto('/app/vault')`. Exija `Nenhum caso ainda. Crie o primeiro para organizar os arquivos por processo.` e capture a tela.
- Clique em `page.getByRole('button', { name: 'Novo caso', exact: true })`. Preencha `page.getByLabel('Título', { exact: true })` e `page.getByLabel('Descrição', { exact: true })`. O botão inicial passa a se chamar `Cancelar`.
- Para provar cancelamento, clique em `Cancelar` e confirme que o título não aparece como caso. Abra o formulário novamente e preencha os dados.
- Opcionalmente abra `page.getByRole('button', { name: 'Dados do cliente (opcional)', exact: true })` e preencha os campos `Nome` e `E-mail`. Capture o formulário. Clique em `Criar caso` e confira o link que contém o título.
- Consulte `vault_case` por nome e escritório com `deleted_at IS NULL`; exija uma linha. Abra `page.getByRole('link').filter({ hasText: title })`, confira URL `/app/vault/cases/` e título de nível 1. Recarregue e confira o mesmo caso.
- Volte ao Cofre. Clique em `page.getByRole('button', { name: 'Ver em lista', exact: true })`, confira `aria-pressed="true"` e abra o mesmo caso. Repita com `Ver em cartões`. Registre as duas entradas.
- No Início, abra o link do caso e confirme a mesma página. Em 390×844, abra o Cofre pela barra móvel e confira a ação `Novo caso`, os links e ausência de rolagem horizontal.
- Capture estado vazio, formulário, caso salvo e visão móvel; preserve a leitura de persistência e as ações na trace.

## Gotchas

- O nome acessível do link pode incluir descrição e contagem. Filtre pelo título único em vez de exigir igualdade do nome completo.
- `Cofre` fica visualmente oculto como `h1` no móvel; o título do caso continua visível.
- Upload e processamento são provas distintas. Esta instância não isola o armazenamento de arquivos nem inicia worker; limite esta receita a metadados de casos.
- Google Drive exige integração configurada. Não execute importação como parte desta receita.
- Ainda não existe `drive-vault-cases.mts`. Os seletores foram conferidos no código; os fluxos precisam de execução própria.
