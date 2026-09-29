# Authentication

A new user creates an account and an office in one step, signs in with e-mail and password, and signs out. Signing out ends the sessions on every device. `/app` routes require a valid server session.

## Sub-features

- `auth-sign-up`: "Crie sua conta" registers name, office, e-mail and password, then lands in `/app`.
- `auth-sign-up-validation`: field errors ("Informe seu nome completo.", "As senhas precisam ser iguais.") and the duplicate e-mail message.
- `auth-sign-in`: "Entre no Lume" with valid credentials lands in `/app/…`. Wrong credentials show "E-mail ou senha incorretos." as `role=alert`.
- `auth-guard`: visiting `/app/command-center` without a session redirects to `/sign-in`.
- `auth-sign-out`: the sidebar "Sair" (title "Encerrar sessão em todos os dispositivos") returns to `/sign-in` and revokes every session of the user.

## How to get to it (user POV)

- `/sign-up`, or the "Criar conta" link on `/sign-in`.
- `/sign-in`, or the "Entrar" link on `/sign-up`.
- "Sair" at the bottom of the desktop sidebar. On mobile it is inside "Mais" (`dialog "Mais opções"`).

## Driving it with Playwright (session.mts)

Preconditions:

- `doctor` all OK. For sign-up, use `openApp('auth', { signIn: false })` and a unique e-mail such as `novo-<suffix>@k5.test`.

- **Sign up.** On `/sign-up`, fill `label "Nome completo"`, `label "Nome do escritório"`, `label "E-mail"`, `label "Senha"` and `label "Confirmar senha"`, then click `button "Criar conta"`. The URL becomes `/app/…`, and the sidebar shows the office name.
- **Stored.** Run `sql('SELECT o.name, m.role FROM "user" u JOIN office_member m ON m.user_id=u.id JOIN office o ON o.id=m.office_id WHERE u.email=$1')`. Expect the office name and `administrator`.
- **Guard.** In a new context without cookies, `goto('/app/command-center')` ends at `/sign-in`.
- **Sign in.** On `/sign-in`, fill `label "E-mail"` and `label "Senha"`, then click `button "Entrar"`. `waitForURL('**/app/**')`.
- **Sign out.** Click the sidebar `button "Sair"`. The URL becomes `/sign-in`. Revisit `/app/command-center`, which redirects to `/sign-in`. Run `sql('SELECT count(*) FROM session s JOIN "user" u ON u.id=s."userId" WHERE u.email=$1')`, which should return `0`.
- **Proof.** Screenshots of the filled sign-up form, the landing page, the sign-in error alert and the post-logout `/sign-in`, plus the session count.

## Gotchas

- Sign-in and sign-up allow 10 attempts per minute, and without `K5_CLIENT_IP_HEADER` all clients share one bucket. Repeated failing drives hit "Muitas tentativas. Aguarde um minuto…".
- Signing out as `verify@k5.test` revokes the session of every other open driver context for that user. Run sign-out last, or with its own account.
- The password field has a "Mostrar senha" toggle. Target it by label, not by `type=password`.
