# Artifacts per case

Artifacts belongs to each Cofre case. Related private documents and authorized saved copies appear here; the conversation remains private.

## Sub-features

- artifacts-list: only related private originals and authorized copies appear.
- artifacts-save-document: inline format, destination and folder choices default to the current case.
- artifacts-repeat: repeating a copy preserves one document and its provenance.
- artifacts-isolation: another case is empty, another person and an anonymous session are refused.
- artifacts-mobile: list and save form fit at 390px.

## How to get to it (user POV)

Cofre -> open a case -> Artefatos. The chat header has no Artefatos button.

## Driving it with e2e

Test: `apps/web/e2e/conversation-artifacts.e2e.ts`

The test registers an account and creates cases, a folder and a conversation through the API. It seeds the model-produced document, saves a DOCX through the API and repeats that save through the UI. SQL confirms provenance; API reads confirm the unrelated case is empty and unauthorized sessions are refused.

## Gotchas

- The isolated instance has no AI connection: seeded content does not prove model generation.
- PDFs and attachment copies are covered by apps/web/tests/conversation-artifacts.test.ts; this e2e drives DOCX.
- apps/web/tests/case-artifacts.test.ts verifies association, deletion and case access against real PostgreSQL.
