# Vault upload

The Cofre accepts a file up to exactly 100 MB and refuses one byte more with "O arquivo excede o limite de 100 MB."; a file sent straight into a case folder keeps its name and folder, finishes processing (`ready`), and downloads with the same content.

## Sub-features

- `upload-limit`: `POST /api/vault/uploads` returns 201 for 100 MB and 400 with the pt-BR error for 100 MB + 1 byte; the upload ref is stored for the user.
- `upload-direct`: `POST /api/vault/documents` with scope `case`, case and folder headers returns 201; `vault_document.folder_id` matches and `status` reaches `ready`.
- `upload-download`: `GET /api/vault/documents/<id>/download` returns the original text.
- `upload-ui`: the Cofre's upload button and multiple-file picker (no drop handler exists in the current widget) (not driven by this test; drive the screen with a new e2e test if a UI change touches it).

- `upload-ref`: Referência temporária pertence ao usuário/escritório, expira e não pode ser consumida duas vezes.
- `upload-batch`: Lote mostra progresso e continua após falha de um arquivo, preservando os sucessos.

## How to get to it (user POV)

- Sidebar "Cofre" (`/app/vault`), then a case and its folder. The test calls the same endpoints the upload UI calls, with the signed-in session's cookies.

## Driving it with e2e

Test: `apps/web/e2e/vault-upload.e2e.ts`

Preconditions:

- `doctor` all OK. The tests sign in as the verification account through `ApiSession` and create a uniquely named case and folder.

- **Limit.** Send 100 MB + 1 byte, expect 400 and the error text; send exactly 100 MB with `x-k5-file-name`, expect 201 and `byteSize` equal; `sql` confirms `vault_upload_ref.byte_size` and ownership.
- **Direct.** Create a case and a private folder; upload `Procuração <n>.txt` with `x-k5-upload-scope: case`, `x-k5-upload-caseid`, `x-k5-upload-folderid`; poll `vault_document.status` until `ready`; download and compare the text.
- **Proof.** `drive vault-upload` returns both tests passed.

## Gotchas

- These are HTTP-level tests (no screen); they prove the server path the UI uses, not the upload widget.
- Writes need an origin matching the instance for CSRF checks. Authenticated GET downloads do not require that header.
- On this instance the `.txt` reaches `ready` without `pnpm worker`. Do not generalize that to PDFs that need OCR or the LibreOffice/PDF path; prove those in CI or with the worker running.

- **Revisão de fonte; sem execução nesta etapa:** Testes dirigem APIs de limite e upload TXT; Node processa imediatamente após a resposta. Botão/lote e formatos PDF/OCR precisam de complementos; Cloudflare tem dependências próprias.
- [Grafo e roteiro por subitem](../coverage/README.md). Consultar as dependências do cenário antes de bloquear a funcionalidade inteira.
