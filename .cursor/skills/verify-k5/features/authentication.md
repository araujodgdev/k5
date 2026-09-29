# Cadastro, entrada e saída

Uma pessoa cadastra sua conta e escritório, entra por e-mail e senha e encerra suas sessões. As páginas internas exigem uma sessão válida.

## Sub-features

- `auth-guard`: redirecionar acesso anônimo ao login.
- `auth-sign-in`: entrar com a conta temporária e chegar ao Início.
- `auth-invalid`: exibir erro sem liberar a área interna.
- `auth-sign-up`: criar conta e escritório pelo formulário.
- `auth-sign-out`: encerrar todas as sessões pela interface.

## How to get to it (user POV)

- Abrir `/sign-in` ou seguir `Entrar` na página pública ou no cadastro.
- Link `Criar conta` no login ou endereço `/sign-up`.
- Botão `Sair` no rodapé do menu desktop.
- Em móvel, botão `Mais`, diálogo `Mais opções`, depois `Sair`.
- Abrir uma rota `/app` sem sessão também leva ao login.

## Driving it with Playwright (session.mts)

Preconditions:

- `doctor` saudável. Use `openApp('authentication', { signIn: false })` para começar sem cookies.
- Reutilize `state.account` para login. Crie outra conta somente quando a funcionalidade em teste for o próprio cadastro, neste banco temporário.

- Abra `page.goto('/app/command-center')` e exija URL `/sign-in` e título `Entre no Tises`.
- Preencha `page.getByLabel('E-mail', { exact: true })` e `page.getByLabel('Senha', { exact: true })` com `state.account`. Clique em `page.getByRole('button', { name: 'Entrar', exact: true })`; exija `/app/command-center` e o título `Início` no DOM. Recarregue para comprovar continuidade da sessão.
- Em contexto separado, tente uma senha incorreta uma vez. Exija `page.getByRole('alert')` visível e permanência em `/sign-in`. Capture o alerta, sem expor a senha.
- Para cadastro, siga `Criar conta`, preencha os rótulos `Nome completo`, `Nome do escritório`, `E-mail`, `Senha` e `Confirmar senha`, e clique no botão `Criar conta`. Use e-mail único `cadastro-<runId>@k5.test`. Exija a área interna e confirme por leitura o escritório e vínculo `administrator` desse e-mail. A conta criada por `up` via API é preparação e não comprova este caminho de UI.
- Para logout global, entre com a mesma conta em dois contextos de navegador independentes. No primeiro, clique no botão `Sair`; exija `/sign-in`. No segundo, recarregue `/app/command-center` e exija o mesmo redirecionamento. Uma leitura da tabela `session`, filtrada pelo ID desse usuário, deve retornar zero.
- Repita a abertura de `Sair` pelo menu móvel e registre a entrada. Capture o estado autenticado antes da ação, o clique na trace e o login após a saída. Feche os dois contextos em `finally`.

## Gotchas

- O logout é global. Faça-o ao final, sem outro driver usando a mesma conta.
- Há limitação de tentativas; não repita credenciais inválidas em um loop.
- `Mostrar senha` muda o tipo do campo. Use o rótulo acessível para localizá-lo.
- O login está coberto pelo driver de tarefas. Guarda anônima, cadastro, erro, saída global e menu móvel ainda precisam de uma execução própria; esta receita não afirma que já passaram.
