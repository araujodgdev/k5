# Vault cases

A member creates a case in Cofre to organize files by legal matter, optionally with client data, and opens the case page. File upload and processing need `pnpm worker`, which this instance does not run.

## Sub-features

- `cases-empty`: an office without cases shows "Nenhum caso ainda. Crie o primeiro para organizar os arquivos por processo."
- `cases-create`: "Novo caso" → "Criar caso" stores a case with title and description.
- `cases-client`: "Dados do cliente (opcional)" adds client name, CPF/CNPJ, e-mail, phone and notes.
- `cases-open`: the new case appears in the grid or list and opens `/app/vault/cases/<id>` with the title as `h1`.
- `cases-view-mode`: "Ver em cartões" and "Ver em lista" switch the layout.
- `cases-upload`: sending documents to a case (not verifiable here without the worker).

## How to get to it (user POV)

- Sidebar "Cofre" (`/app/vault`), then the "Novo caso" button.
- On mobile: the bottom tab "Cofre".

## Driving it with e2e

Test: `apps/web/e2e/agent/vault-cases.e2e.ts`

Preconditions:

- `doctor` all OK. For `cases-empty`, use a fresh instance (`down` + `up`) before creating any case.

- **Empty.** Go to `/app/vault`. The empty-state text above is visible.
- **Open form.** Click `button "Novo caso"`. It gets `aria-expanded="true"` and turns into "Cancelar". The fields `label "Título"` and `label "Descrição"` appear.
- **Client data.** Click `button "Dados do cliente (opcional)"`, then fill `label "Nome"` and `label "E-mail"`.
- **Create.** Click `button "Criar caso"`. The case title is listed.
- **Stored.** Run `sql("SELECT c.name, o.name AS office FROM vault_case c JOIN office o ON o.id=c.office_id WHERE c.name=$1 AND c.deleted_at IS NULL")`. Expect one row in `Escritório de Verificação`.
- **Open.** Click the case link. The URL matches `/app/vault/cases/`, and `h1` equals the title.
- **Proof.** Screenshots of the empty state, the filled form and the case page, a reload of the case page, and 390px screenshots of `/app/vault`.

## Gotchas

- The page `h1 "Cofre"` is `sr-only` on mobile.
- Titles need at least 2 characters after trimming. Shorter titles show a `role=alert` error without calling the API.
- "Importar do Google Drive" needs Google keys, which are blanked here. Report it as unverifiable, not as broken.
