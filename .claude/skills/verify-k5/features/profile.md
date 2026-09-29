# Profile

A person edits their own profile (name, practice, OAB, city, a short text and a photo) and their access credentials (e-mail and password, both behind the current password). Whoever types that e-mail while inviting an associate or a case participant sees the person's name and, on hover, focus or tap, a card with the photo and profile summary.

## Sub-features

- `profile-edit`: "Salvar perfil" stores the fields; the name shows in the sidebar footer.
- `profile-photo`: "Adicionar foto" / "Trocar foto" crops and shrinks the image to 256px in the browser; "Remover" clears it.
- `profile-password`: "Alterar senha" needs the current one and can end the other sessions.
- `profile-email`: "Alterar e-mail" needs the current password; an address of another account is refused.
- `profile-card-invite`: typing an existing user's e-mail in "E-mail da pessoa" shows "… já usa o Lume" with the card on hover.
- `profile-card-lists`: associate, team and participant rows show the avatar, and the e-mail opens the card.
- `profile-mobile`: the page fits 390px; "Mais" leads with the person's row linking to Perfil.

## How to get to it (user POV)

- Desktop: the person's name and photo at the top of the sidebar footer → `/app/profile`.
- Mobile: tab "Mais" → first row (name, "Perfil").
- Cards: Escritório → Associados/Equipe → "Convidar …", and a case's Participantes tab.

## Driving it with Playwright (session.mts)

Preconditions: a second account, created with `POST /api/auth/sign-up/email` in a separate browser context (with an `origin` header), and its profile set through `PATCH /api/profile`.

- The photo input is visually hidden; use `locator('input[type=file]').setInputFiles(...)` with a PNG drawn on a canvas in the page.
- The card trigger is the button "Ver perfil de <e-mail>"; the card is `[data-slot=hover-card-content]`.
- The driver changes the verification account's e-mail and password, then restores both before it moves on.

## Gotchas

- Changing the password with "Encerrar a sessão nos outros dispositivos" keeps the current tab signed in; other contexts of the same account are signed out.
- An e-mail that belongs to another account answers like a success on the auth endpoint; the page re-reads the session and says it is in use.
- E-mail lookups are limited to 60 per person every 10 minutes.
- The wrong-password attempt logs one expected `400` console entry on `/app/profile`; the driver allows exactly that one.
- "Salvar perfil" is disabled until something changes, so the driver writes a per-run suffix in Sobre.
