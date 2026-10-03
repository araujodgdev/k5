# Conversation artifacts

In the Lume chat, the "Artefatos" button opens the panel of everything the conversation produced or received: the Lume's documents and the files sent in its messages, each with the Vault copies already made, followed by the Vault material selected as context. "Salvar no Cofre" on a row opens an inline form (format PDF or DOCX for documents, destination Biblioteca or a case, and a root folder) and copies the file into the Vault; repeating the same request returns the same copy.

## Sub-features

- `artifacts-list`: a document written in the conversation and a sent attachment are listed; unsent attachments and other conversations' documents are not.
- `artifacts-save-document`: a document saved as DOCX to the Biblioteca shows "<título>.docx foi salvo em Biblioteca." and a "No Cofre (DOCX, versão 1)" line.
- `artifacts-save-attachment`: an attachment saved from the keyboard at 390px.
- `artifacts-save-error`: a failed save keeps the form and offers "Tentar de novo".
- `artifacts-context`: "Do Cofre nesta conversa" keeps the old Fontes selection (not driven; unchanged behavior).
- PDF copies need the PDFcn renderer; covered by `apps/web/tests/conversation-artifacts.test.ts`.

## How to get to it (user POV)

- Sidebar "Lume" → button "Artefatos" in the top bar (`/app/agents`). The same button on mobile.

## Driving it with e2e

Test: `apps/web/e2e/conversation-artifacts.e2e.ts`

Preconditions: none. The test signs up its own account, creates the conversation and uploads the attachment through the app's API, and seeds the Lume document and the message claim (both only produced by a model run).

## Gotchas

- The instance has no AI connection, so the documents are seeded instead of written by the Lume.
