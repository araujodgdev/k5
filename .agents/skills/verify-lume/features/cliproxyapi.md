# CLIProxyAPI

Platform administrators can choose CLIProxyAPI in the existing AI connections and assign it to a group or task. Creating the connection preserves the current model choices. People use the same Lume chat and saved history. Each person can run three conversations at once, including conversations started by task delegation.

## Sub-features

- `provider-selection` selects CLIProxyAPI, saves a connection and assigns a model on desktop and at 390px, including keyboard submission.
- `existing-assignments` checks that creating the proxy connection preserves the Agente model selection.
- `history` sends a real prompt from a new account, reloads the completed answer and checks the saved owner and released slot.
- `isolation` refuses a second account access to the first account's conversation.
- `capacity` admits three turns per person, refuses a fourth with 429, and allows another after a turn completes, stops or fails.


## How to get to it (user POV)

1. Open **Administração**, then **IA**.
2. Choose **Nova conexão**, select **CLIProxyAPI (Lume)** in **Provider**, enter its key and save.
3. Under **Modelos por tarefa**, edit the intended group or task. Choose the connection and **gpt-6-luna**, then save.
4. Sign in as an office user, open **Lume**, create a conversation and send a message.

## Driving it with e2e

Test: `apps/web/e2e/cliproxyapi.e2e.ts`

Preconditions:

- Run `doctor` on the isolated instance. Use its canonical `localhost` URL so Next.js and Origin agree.
- The default tests use synthetic credentials and make no model requests. Their disposable account receives platform access through the production `platform:admin grant` command.
- Real chat is explicitly optional. Set `K5_E2E_REAL_AI=1` in the runner and provide `K5_E2E_CLIPROXYAPI_KEY_FILE` pointing to a private key file. Alternatively set `K5_E2E_CLIPROXYAPI_KEY`. Never put the key in a shell argument, screenshot or trace.
- Run `drive cliproxyapi --video`. The default instance disables external AI. The optional test registers its connection through the real admin API using Node's `ApiSession`, then restores the previous task assignment and removes its connection.

The admin tests select and save the provider at 1280px and 390px, reload the assignment, read it from PostgreSQL, and capture screenshots. The optional chat test creates a separate office account, sends a marker through the UI, waits for the saved assistant answer, reloads it, checks ownership, and tests another account's access through the real API.

For a live capacity proof, configure the isolated instance explicitly for real AI. Start long answers in three different conversations for one user, then submit a fourth. Confirm the 429 message and unchanged fourth history. Repeat after **Parar resposta**, after completion, and after a provider error. A second user must still be able to start a turn. Include a task opened with **Delegar ao Lume** among the three. Use the deterministic PostgreSQL race tests in `tests/chat-lease.test.ts` and `tests/chat-route.test.ts` to prove atomic admission and stale-writer protection even when real responses finish too quickly to overlap.

## Gotchas

- Never report the skipped real-AI test as a verified chat. No private proxy key is required in CI.
- Images are enabled only for the proven **gpt-6-luna** model. Other proxy models, direct PDF input, audio transcription and embeddings remain unavailable. Extracted Cofre text still works.
- A saved conversation is not an active execution. Saved history has no three-conversation cap.
- A crashed execution's slot expires within five minutes. A missing local executor does not justify clearing another process's lease.
- Node tests cover the shared start and fencing operations used by both Node and the Durable Object. Hosted Durable Object runtime proof requires a Cloudflare environment and is separate from this local recipe.

- **Revisão de fonte; sem execução nesta etapa:** Chat real é opt-in com K5_E2E_REAL_AI=1 e chave privada no runner. Capacidade de três turnos não é coberta pelo simples cadastro do provedor.
- Chat exige saldo de créditos ou isenção. O e2e opt-in não substitui três turnos simultâneos nem prova no runtime Cloudflare.
- [Grafo e roteiro por subitem](../coverage/README.md). Consultar as dependências do cenário antes de bloquear a funcionalidade inteira.
