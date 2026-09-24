# Identity, integrations and persistence audit ledger

Read-only discovery pinned to root baseline main 5e6ab96 plus existing Google default-on edits. All assigned declarations and table rows read. Discovery initially made no test/source edits or executions. The authorized cutover is recorded below; no test executions by this lane. Baseline file outcomes: baseline-files.json.

CI: .github/workflows/ci.yml runs pnpm test; scripts/test-postgres.ts discovers every tests/*.test.ts and supports explicit paths. Focused commands below use pnpm --filter @k5/web test followed by listed tests/ paths.

Production owners inspected: auth-core/offices/platform-core/platform-crypto/credential-rotation/ai-connections-core; application agenda/approvals/idempotency/context; Google connections/operations/write-context/environment/policy/routes/worker and Gmail service/mime/triage, Drive service/import/formats/docs, Calendar sync and service; db/postgres/request; notifications repository/worker/revocation; vault-api. Dependency source inspected: BetterAuth sign-out route (upstream deletes only current session; Lume hook owns global revoke). Retention judgments use specific contracts below. After the initial discovery pass, full retained-owner reads were completed for Calendar service/model, vault/storage/uploads, notifications repository/worker/events/policy/subscriptions/contracts, Google transport/config/jobs/approval-review, agenda service/contracts, trusted-origins, database/migrations, auth/session and AI providers. Every assigned test body and table row was read in full. Shared transitive subsystems such as the rest of AI-store are owned by their corresponding campaign lanes; this lane read claimRun and its surrounding owner context.

History: 4962212 introduced authenticated transactional all-secret rotation, leaving former exports unused; 184bf0b introduced Google;85c21d1 fixed integration review findings. 34b75d8 fixes manual validation failures; f696c40 PostgreSQL migration; cc0d212 platform-global AI. New google-default-access is the current reported deployment regression and stays intact.

Non-test callers: auth.ts creates auth and api/auth route invokes handler; session.ts uses office lookup; platform core is called by platform.ts and platform-admin.ts; credentials route calls rotateCredentials; integrations Google operation route and application/google-service dispatch service calls; worker-node/worker-edge invoke imports/sync; notifications routes and notification worker call repository/projector; capability registry dispatches agenda/vault; approvals routes call publicApproval; setup.ts calls countSecretsNeedingReencryption.

## Per-declaration ledger

### tests/agenda.test.ts

- **R** tests/agenda.test.ts:23 — 'agenda: clients, links, partial updates and stale versions preserve data': partial update preserves email, notes, stage and links; stale compare-and-swap cannot delete links.
- **R** tests/agenda.test.ts:40 — 'agenda: office isolation covers reads, updates and every foreign reference': cross-office get/update/list plus each foreign reference rejects independently.
- **R** tests/agenda.test.ts:58 — 'agenda: reviewer tools are read only and revoked roles are checked at execution': live role reread blocks revoked writer; reviewer publication and all input/output JSON schemas stay usable.
- **R** tests/agenda.test.ts:73 — 'agenda: UTC normalization, overlapping meetings, civil dates and undated tasks': UTC conversion, overlap filtering, undated pagination and invalid civil dates.
- **R** tests/agenda.test.ts:92 — 'agenda: completion preserves scheduling and links; retries and concurrent edits': completion preserves fields and concurrent updates produce one winner.
- **R** tests/agenda.test.ts:107 — 'agenda: simultaneous create retries commit exactly one client and one activity': five rounds of eight simultaneous client/activity creates verify DB uniqueness.
- **R** tests/agenda.test.ts:123 — 'agenda: client address and practice areas, filters, partial updates and retries': profile normalization, area filters, independent office isolation and update clearing.

### tests/auth.test.ts

- **R** tests/auth.test.ts:36 — "cadastro cria sessão, hash forte e escritório com administrador": real signup cookie/security, strong hash, admin provisioning and idempotent office recovery.
- **R** tests/auth.test.ts:55 — "dados inválidos e e-mail duplicado não criam contas ou escritórios extras": invalid signup and case-insensitive duplicate email leave no orphan office.
- **R** tests/auth.test.ts:70 — "login recusa senha incorreta e aceita credenciais válidas": wrong-password 401 plus valid real session.
- **R** tests/auth.test.ts:82 — "escritório A não acessa B e cadastro não aceita escritório ou papel fornecido pelo cliente": forged office/role cannot choose tenant; database rejects unsupported role.
- **R** tests/auth.test.ts:97 — "logout invalida todos os dispositivos do usuário e preserva outras contas": global sign-out invalidates both sessions while preserving other user.
- **R** tests/auth.test.ts:109 — "sessões ausentes, forjadas e expiradas não autenticam; uso renova a validade": missing/forged/expired cookies fail and active session expiration slides.
- **R** tests/auth.test.ts:123 — "requisições de outra origem são recusadas": foreign-origin signup returns403 without inserting user.
- **R** tests/auth.test.ts:131 — "limita tentativas repetidas de login": same trusted client blocked at11th login while distinct client has its bucket.
- **R** tests/auth.test.ts:141 — "fora da Cloudflare, cf-connecting-ip forjado não abre um limite novo": outside Cloudflare changing spoofable cf-connecting-ip does not reset bucket.
- **R** tests/auth.test.ts:150 — "logout revoga sessões mesmo quando a limpeza de push falha": push cleanup exception still revokes every session before returning500.
- **R** tests/auth.test.ts:168 — "logout de outra origem não encerra a sessão legítima": cross-origin logout cannot revoke legitimate session.

### tests/credential-rotation.test.ts

- **R** tests/credential-rotation.test.ts:37 — 'two-phase keyring reads old data, writes the staged key and supports promotion without exporting the old key': stage/promote keyring reads old+previous data and writes new key.
- **R** tests/credential-rotation.test.ts:51 — 'rotation covers every encrypted column atomically, preserves empty references and is idempotent': all11 encrypted columns migrate atomically, empty consumed references survive, retry is idempotent.
- **R** tests/credential-rotation.test.ts:68 — 'an unreadable final table rolls back earlier changes and audit, including damaged current-key payloads': late damaged current-key table rolls back earlier writes/audit; missing admin and wrong key reject.
- **R** tests/credential-rotation.test.ts:81 — 'real route requires a live platform session, same origin and the reviewed target key': actual credentials GET/POST enforces live session, platform role, origin, readiness, target-key and strict body.

### tests/google-calendar.test.ts

- **R** tests/google-calendar.test.ts:33 — 'private calendars and events cannot cross owner, even when the other owner is administrator': same-office admin and other office cannot read private mirrors or select another calendar.
- **R** tests/google-calendar.test.ts:44 — 'shared event projects only owner reviewed fields and is visible to office': explicitly reviewed share exposes public projection without private summary.
- **R** tests/google-calendar.test.ts:58 — 're-sharing refreshes the reviewed time and hides cancelled or remotely deleted events': re-sharing updates reviewed all-day interval; cancellation/remote deletion hides stale share.
- **R** tests/google-calendar.test.ts:79 — 'all-day recurrence expands for the requested window and reader calendars refuse writes': real list expansion preserves exclusive all-day end and rejects reader writes.
- **R** tests/google-calendar.test.ts:98 — 'writer without private access can edit public events but cannot read or mutate private ones': writerWithoutPrivateAccess sees/writes public only; hidden remote rows stay synced across repeat listing.
- **R** tests/google-calendar.test.ts:134 — '412 refetch reapplies only edited field and preserves remote attendee RSVP': HTTP412 refetch reapplies only changed field and keeps attendee RSVP.
- **R** tests/google-calendar.test.ts:157 — 'remote deletion creates a visible pending state and never recreates the event': remote404 records pending state and never recreates event.
- **R** tests/google-calendar.test.ts:169 — 'cancelled synced event disappears from agenda while a conflict remains visible': synced cancellation hides event while conflict stays visible even without next tombstone.
- **R** tests/google-calendar.test.ts:192 — 'lost create response reconciles by stable event id without a second insert': lost create response reconciles durable ID at fake HTTP boundary with one POST.
- **R** tests/google-calendar.test.ts:213 — 'approval reviews show complete creation details and readable update changes': approval data includes creation and changed values before any Google mutation.
- **R** tests/google-calendar.test.ts:243 — 'following split preserves COUNT and a future exception with a durable checkpoint': following recurrence split preserves COUNT and remaps future exceptions/checkpoint.
- **R** tests/google-calendar.test.ts:290 — 'incremental sync keeps page cursor until last page and handles 410 with full rebuild': HTTP410 rebuild consumes page2, saves fresh cursor and preserves cancelled rows.
- **R** tests/google-calendar.test.ts:321 — 'push requires matching channel, resource and secret; duplicate notifications dedupe jobs': bad token ignored; valid duplicate notifications enqueue one durable job.

### tests/google-default-access.test.ts

- **R** tests/google-default-access.test.ts:10 — 'Google is available without rollout rows; explicit office blocks still apply': recent user-requested default-on regression: status/connect with no rollout rows plus explicit block.
- **R** tests/google-default-access.test.ts:28 — 'Calendar schedules and accepts push without rollout rows, but honors explicit blocks': recent user-requested default-on scheduling/push with no rollout rows plus explicit block.

### tests/google-drive.test.ts

- **R** tests/google-drive.test.ts:39 — 'seleção é verificada no Google e fica privada até para administrador do mesmo escritório': verified metadata, owner isolation against same-office admin and foreign office, inherited permission display.
- **R** tests/google-drive.test.ts:58 — 'atualização marca arquivo na lixeira como indisponível sem perder metadados ou cópia no Cofre': trashed remote file keeps original metadata/copy; transient500 does not destroy state; restoration updates version.
- **R** tests/google-drive.test.ts:100 — 'importação repetida pela mesma chave é uma cópia só; novo pedido cria versão do mesmo documento': same-key import executes once and later import versions same document.
- **R** tests/google-drive.test.ts:129 — 'Biblioteca importa sem caso e reimporta como versão distinta do destino caso': library scope has independent version lineage from case scope.
- **R** tests/google-drive.test.ts:165 — 'Biblioteca rejeita pasta, destino de outro escritório e papel somente leitura': invalid library folder, foreign case and reviewer produce no import.
- **R** tests/google-drive.test.ts:182 — 'pastas do mesmo caso recebem cópias independentes': different folders preserve independent destination and key reuse rejects mismatch.
- **R** tests/google-drive.test.ts:207 — 'reimportação não altera cópia que foi movida para outra pasta': moved copy remains untouched when source destination is reimported.
- **R** tests/google-drive.test.ts:241 — 'formato nativo, limite de exportação e texto de abas têm tratamento explícito': native export mappings and tab-aware edits are distinct protocol contracts.
- **R** tests/google-drive.test.ts:258 — 'Google Docs escolhido exporta DOCX e recusa exportação acima de 10 MB sem criar documento': native DOCX metadata plus actual export over10MB fails before vault insertion.
- **R** tests/google-drive.test.ts:280 — 'limite de 50 MB é aplicado antes de criar job ou baixar arquivo': known50MB oversize fails before job/download.
- **R** tests/google-drive.test.ts:293 — 'não revoga acesso herdado ou arquivo de outra pessoa': inherited permission and another owner cannot trigger DELETE.
- **R** tests/google-drive.test.ts:303 — 'Docs exige revisão lida novamente quando texto remoto mudou': stale Docs revision requires reread without batchUpdate.
- **R** tests/google-drive.test.ts:318 — 'importação para se o titular perder acesso ao escritório antes do worker': membership removed between enqueue and worker creates no copy.
- **R** tests/google-drive.test.ts:334 — 'versão alterada no Google depois da fila exige novo pedido e não copia bytes novos': source version changed after enqueue fails without media download.
- **R** tests/google-drive.test.ts:351 — 'lease vencida após download não marca importação como falha terminal nem cria versão': expired lease after bytes cannot publish or mark terminal failed.
- **R** tests/google-drive.test.ts:375 — 'efeito desconhecido de renomear bloqueia compartilhamento do mesmo arquivo': rename unknown prevents cross-action share on same remote file.
- **R** tests/google-drive.test.ts:389 — '403 explícito antes de qualquer efeito conclui operação como falha definitiva': definite403 before effect records failed rather than unknown.
- **R** tests/google-drive.test.ts:405 — `expired import attempt cannot delete the winner's object (${staleFinishesFirst ? 'stale cleanup before commit' : 'winner commits first'})`: BOTH ordering rows protect distinct stale cleanup windows; committed bytes survive and stale attempt owns separate key.

### tests/google-email-triage.test.ts

- **R** tests/google-email-triage.test.ts:35 — 'mail triage: bounds input, fetches metadata, caches judgments and invalidates changed snippets': input cap/path validation, metadata-only request, personal cache, no text persisted and snippet invalidation.
- **R** tests/google-email-triage.test.ts:54 — 'mail triage: same thread ids never share judgments across users; uncertainty is explicit': same thread id gets independent personal judgments; uncertain reply stays null.
- **R** tests/google-email-triage.test.ts:63 — 'mail triage: disabled and shadow never apply suggestions; outages do not fabricate labels': off/shadow never expose suggestions; failed provider never invents labels.
- **R** tests/google-email-triage.test.ts:75 — 'mail triage: missing messages are partial, and batches stay bounded': missing404 gives partial and questions stay in four-email batches.
- **R** tests/google-email-triage.test.ts:85 — 'mail triage: removed membership or disconnected consent while evaluating never returns or caches results': revocation during evaluation prevents result return/cache (membership and connection rows).
- **R** tests/google-email-triage.test.ts:97 — 'mail triage: budget and changed configuration fail without applying suggestions': budget and config-change outcomes fail without suggestions.
- **R** tests/google-email-triage.test.ts:108 — 'mail triage: a reply draft does not hide the last sent alias message and today uses Sao Paulo': draft ignored when finding last SENT message; civil today is Sao Paulo.
- **R** tests/google-email-triage.test.ts:123 — 'mail triage: revocation while metadata loads prevents transmitting it to TypeSafe': membership revoked during metadata prevents outbound TypeSafe call.

### tests/google-foundation.test.ts

- **R** tests/google-foundation.test.ts:34 — 'OAuth: state pessoal, uso único, consentimento parcial e logout não desconecta': OAuth session-bound one-use PKCE state, partial consent and logout preserve Google background token.
- **R** tests/google-foundation.test.ts:56 — 'renovação concorrente usa um refresh; desconexão impede retorno tardio do token': concurrent refresh single flight; late token cannot resurrect disconnected connection.
- **R** tests/google-foundation.test.ts:70 — `OAuth refresh preserves tokens and jobs after ${status} ${JSON.stringify(errorBody)}`: ALL4 response-shape rows retain credentials/jobs and release lease, report once and recover.
- **R** tests/google-foundation.test.ts:89 — 'OAuth invalid_grant still requires reconnection and cancels queued work': invalid_grant alone requires reauth and cancels queued work.
- **R** tests/google-foundation.test.ts:100 — 'UI exige aprovação exata; mudança de conteúdo ou política invalida; proprietário isolado': same-office owner approval, changed content/policy rejection and approved replay.
- **R** tests/google-foundation.test.ts:116 — 'limite automático concorrente reserva somente uma unidade e não revela conteúdo na operação': locked automatic quota admits only one write and arguments encrypted.
- **C** tests/google-foundation.test.ts:125 — 'resposta perdida mantém unknown e bloqueia envio equivalente com chave nova': generic unknown effect replay overlaps real Gmail/Drive boundaries; see C2.
- **R** tests/google-foundation.test.ts:136 — 'checkpoint de efeito parcial permanece cifrado; falha posterior não libera repetição': partial effect checkpoint encrypted and errors remain unknown; remove only obsolete assertion-free rotation tail.
- **R** tests/google-foundation.test.ts:146 — 'sessão encerrada e papel removido interrompem ações interativas': interactive session and live writer role gate execution.
- **R** tests/google-foundation.test.ts:153 — 'bindings de Worker não vazam entre execuções simultâneas': AsyncLocalStorage keeps concurrent Worker client IDs isolated.
- **R** tests/google-foundation.test.ts:158 — 'manutenção recupera admissão interrompida e trabalhos Google acordam Node': crash after admission refunds quota once and Node wakes for drive jobs.

### tests/google-gmail.test.ts

- **R** tests/google-gmail.test.ts:15 — 'HTML de terceiros vira texto inerte; identidade e cabeçalhos são protegidos': HTML stripped, CRLF identity rejected, durable Message-ID and encoded subject.
- **R** tests/google-gmail.test.ts:26 — 'assuntos MIME codificados em UTF-8 e ISO-8859-1 são exibidos em texto legível': RFC2047 UTF8/Latin1 mixed encoded words and malformed text retained.
- **R** tests/google-gmail.test.ts:34 — 'corpo de e-mail respeita charsets permitidos e mantém HTML como texto': Latin1/windows1252 body decoding and inert HTML fallback.
- **R** tests/google-gmail.test.ts:49 — 'References malformadas são ignoradas sem impedir resposta; In-Reply-To continua estrito': malformed References filtered and bounded while In-Reply-To stays strict.
- **R** tests/google-gmail.test.ts:68 — 'lista paginada e leitura pessoal sem HTML remoto': pagination, unread flag, inert message view and person-scoped remote fetch.
- **R** tests/google-gmail.test.ts:90 — 'envio tem Message-ID durável; resposta perdida mantém unknown e nova chave não reenvia': unknown send cannot duplicate with new key; actual MIME sender/ID serialized.
- **R** tests/google-gmail.test.ts:113 — 'resposta perdida é reconciliada por prova positiva e não duplica o mesmo envio': positive remote SENT proof reconciles lost response with one send.
- **R** tests/google-gmail.test.ts:135 — 'resposta mantém threadId e cabeçalhos de encadeamento': real send carries threadId and threading MIME headers.
- **R** tests/google-gmail.test.ts:155 — 'confirmação de envio inclui corpo e anexos exatos; rascunho é persistido no Gmail': approval body shown before send and draft really saved/read from fake HTTP.
- **R** tests/google-gmail.test.ts:175 — 'anexo importado exige parte existente na mensagem e caso explícito': nonexistent message part refused; name overclaims explicit-case behavior but assertion valuable.
- **R** tests/google-gmail.test.ts:184 — 'upload de e-mail pertence apenas ao titular, inclusive dentro do mesmo escritório': another same-office user cannot send owner uploaded attachment.
- **R** tests/google-gmail.test.ts:197 — 'editar rascunho permite remover todos os anexos e preserva resposta encadeada': draft update removes attachments and preserves reply headers on PUT.
- **R** tests/google-gmail.test.ts:222 — 'rascunho alterado remotamente após preparação não é sobrescrito': remote draft changed during preparation is never overwritten.
- **R** tests/google-gmail.test.ts:238 — 'mesmo rascunho com nova chave não é enviado duas vezes enquanto o resultado é desconhecido': same draft cannot send under fresh key while unknown.
- **R** tests/google-gmail.test.ts:254 — 'exclusão de rascunho passa pelo executor e retorna sucesso real': DELETE actually invoked once; same-key replay returns actual success.
- **R** tests/google-gmail.test.ts:269 — 'envio concluído de rascunho repete resultado pela chave sem tentar buscar rascunho removido': sent draft replay returns stored result before fetching deleted draft.

### tests/notifications.test.ts

- **R** tests/notifications.test.ts:36 — 'notifications: unread polls seed missing defaults but never write when both exist': unread polling avoids repeated writes; distinct performance regression, keep despite call instrumentation.
- **R** tests/notifications.test.ts:55 — 'notifications: reconciliation advances beyond its limit and revisits timezone changes': bounded reconciliation advances pages and timezone change revisits schedules.
- **R** tests/notifications.test.ts:79 — 'notifications: an accepted agenda mutation emits once and projects only to the intended person': real agenda mutation atomically emits once and projects intended recipient only.
- **R** tests/notifications.test.ts:99 — 'notifications: civil-date reminders use the saved timezone and recover without duplicating': civil-date reminder uses saved zone; crash/reconcile never emits twice.
- **R** tests/notifications.test.ts:117 — 'notifications: subscriptions are encrypted, delivery is generic, and logout generation blocks stale reactivation': encrypted endpoint, generic delivered payload, accepted status and logout-generation rejection.
- **R** tests/notifications.test.ts:150 — 'notifications: case following is personal and the inbox rollout switch hides projected rows': personal follows and independent inbox/capture rollout behavior.
- **R** tests/notifications.test.ts:181 — 'notifications: retention removes old personal and operational data but keeps the dedupe event': retention removes recipient/content but preserves dedupe event.
- **R** tests/notifications.test.ts:196 — 'notifications: mark-all cancels only eligible deliveries in a two-statement batch': read-all cutoff cancels eligible deliveries only and preserves others; remove exact2-statement assertion only if refactoring later.

### tests/platform-auth.test.ts

- **R** tests/platform-auth.test.ts:35 — "anônimo e administrador de escritório sem papel de plataforma não acessam a API da plataforma": real BetterAuth session denies anonymous/forged and office admin without platform role.
- **R** tests/platform-auth.test.ts:48 — "papel de plataforma libera a API e a revogação vale na requisição seguinte": role grants allow request; missing/foreign Origin, next-request role revoke and session revoke enforced.

### tests/platform.test.ts

- **R** tests/platform.test.ts:29 — "AES-256-GCM round trips and rejects wrong master keys and malformed env values": AES authentication and env key validation independent security behavior.
- **R** tests/platform.test.ts:40 — "platform role is independent and revocation takes effect immediately": CLI grant idempotency + user lookup normalization are distinct from HTTP session proof.
- **C** tests/platform.test.ts:56 — "writes require an allowed same origin": same-origin predicate layer can retire after exact negative cases move to actual route; see C3.
- **R** tests/platform.test.ts:65 — "platform connections are masked, audited, rotated and serve every office": masked global credentials, rotation, audit and enable state.
- **R** tests/platform.test.ts:85 — "per-office rows from before 0022 are never read, and the migration adopts the most recent office's": executes0022 adoption SQL and preserves legacy secret from newest office.
- **R** tests/platform.test.ts:105 — "task assignment is exclusive and deletion erases the secret after assignments are removed": exclusive task assignment and delete erases ciphertext after unassign.
- **R** tests/platform.test.ts:120 — "the Lume's model choice applies to chat, extraction and drafting on the platform": one admin-selected model applies to three task types while embedding stays independent.
- **R** tests/platform.test.ts:154 — "master key versioning: key id in envelope, previous keys decrypt, legacy v1 payloads still work": v2 envelope+legacyv1 decryption and invalid previous-key config compatibility.
- **C** tests/platform.test.ts:178 — "rotation re-encrypts every live secret with the current key, audits without secrets and is atomic": obsolete pre-4962212 rotation path; see C1.
- **R** tests/platform.test.ts:207 — "connection test accepts any enabled connection, hides provider failures and audits without secrets": connection testing chooses configured/default model and masks provider failure in audit.
- **R** tests/platform.test.ts:234 — "request bodies are size-capped and schema-validated": stream/body size caps and strict schemas prevent wrong tenant/task fields.
- **R** tests/platform.test.ts:252 — "error responses never log or return secret-bearing messages": secret-free error response and logs, typed status mapping.
- **R** tests/platform.test.ts:267 — "concurrent resolution binds the platform credential to the model, and disabling it stops every office": resolved Mastra model binds correct key under concurrency and honors disabling/default.
- **R** tests/platform.test.ts:292 — "every supported provider can be stored and resolved with its own credential": each supported provider storage/resolution is observable adapter contract.
- **R** tests/platform.test.ts:308 — "dynamic model resolution supports an internally pinned run model": queued pinned model, provider defaults and no unsupported embedding fallback.

### tests/postgres.test.ts

- **R** tests/postgres.test.ts:10 — 'SQL binding preserves literals, quoted names, comments and dollar-quoted bodies': SQL adapter preserves strings/comments/dollar bodies while binding names.
- **R** tests/postgres.test.ts:15 — 'live idle connection failures are reported, while closed request sockets stay quiet': idle pool errors reported but post-end sockets ignored.
- **R** tests/postgres.test.ts:25 — 'PostgreSQL decodes DTO values and rolls the entire batch back on constraint failure': real pg DTO decode and constraint-error batch rollback.
- **R** tests/postgres.test.ts:38 — 'concurrent request contexts and worker claims stay isolated': AsyncLocalStorage request pools isolated and concurrent run claims unique.
- **R** tests/postgres.test.ts:55 — 'request pool remains open through streaming and closes on completion or cancellation': stream keeps request pool open through consumption and cancels/end closes exactly once.
- **R** tests/postgres.test.ts:74 — 'migration checksums ignore CRLF checkouts but still detect real edits': CRLF normalization preserves checksum while actual SQL edits differ.

### tests/security.test.ts

- **R** tests/security.test.ts:51 — "storage: a caller-supplied key cannot escape the vault root": traversal/unknown upload rejected and storage key validity.
- **R** tests/security.test.ts:76 — "storage: the Worker R2 binding is preferred without S3 credentials": Worker R2 adapter works without S3 credentials.
- **R** tests/security.test.ts:111 — "uploads: a reference is single use and bound to its office and its person": single-use upload scoped to user and office.
- **R** tests/security.test.ts:136 — "tombstone: a deleted document cannot be resurrected through retry": deleted failed document cannot resurrect by retry; reads/lists hide and cleanup queued.
- **R** tests/security.test.ts:164 — "retry: a document left in the queue can be requeued, a live one cannot": queued retry stays claimable while processing is protected.
- **R** tests/security.test.ts:191 — "case deletion: the documents filed in a case go with it": case deletion tombstones children/removes chunks then queues vectors/objects.
- **R** tests/security.test.ts:214 — "case deletion: targetCaseId moves the documents instead of deleting them": target case move preserves docs and avoids physical deletion.
- **R** tests/security.test.ts:230 — "case deletion: no approval, no deletion": case delete without approval cannot modify child.
- **R** tests/security.test.ts:244 — "idempotency: a reused key with different arguments conflicts instead of replaying": key hash and capability collision fail; personal namespace isolates colleague.
- **R** tests/security.test.ts:271 — "approval: a nested argument change invalidates the approval": nested values affect canonical approval; reorder allowed, second consumption denied.
- **R** tests/security.test.ts:306 — "approval: a colleague cannot approve a proposal addressed to someone else": same-office colleague cannot approve owner proposal (cross-office test is not substitute).
- **R** tests/security.test.ts:316 — "approval: concurrent decisions cannot overwrite the first transition": competing reject/approve cannot overwrite first terminal transition.
- **R** tests/security.test.ts:333 — "publication: no adapter may offer a capability marked unpublished": explicit no-global-logout adapter publication and reviewer restriction.
- **R** tests/security.test.ts:347 — "origins: the wildcard the tunnel default declares is honoured, and nothing wider": wildcard accepts only one label, exact scheme/port, rejects lookalikes/path/null.
- **C** tests/security.test.ts:375 — "vault routes answer domain validation errors with 400 and the domain message": domain CapabilityError serialization belongs in vault error owner; see C4.
- **R** tests/security.test.ts:381 — "approval responses omit tenant ids and the stored input": public HTTP DTO excludes tenant/input and serializes expiry.
- **R** tests/security.test.ts:391 — "meeting ending before it starts fails with a custom pt-BR issue": ptBR custom Zod issue specifically drives user-visible validation.

## Candidate evidence and second-pass layer plan

### C1 — retire obsolete AI rotation layer (one executed test here; one coordinated TypeSafe test)

Exact candidate: platform.test.ts:178, "rotation re-encrypts every live secret with the current key, audits without secrets and is atomic".

Actual detectable failures: stale AI/TypeSafe keys not rewritten; legacy v1 unreadable; duplicate rewrites; partial writes on decryption error; secret-bearing audit; wrong live model-key error conversion. Covered owner is reencryptAiConnectionSecrets, whose only references are this test and typesafe.test.ts:356 (confirmed repository-wide rg). It has NO non-test caller. Its sibling countSecretsNeedingReencryption DOES have setup.ts caller and must remain.

History/reason: pre-4962212 key rotation used platform-admin CLI and D1-compatible in-memory re-encryption/batch. Commit4962212 replaces operational entry with /api/platform/credentials and rotateCredentials transaction, locks and all-column allowlist. Old function still exists solely for tests. Keeper: credential-rotation.test.ts:51, 'rotation covers every encrypted column atomically, preserves empty references and is idempotent', plus :68 'an unreadable final table rolls back earlier changes and audit, including damaged current-key payloads', :81 real route; platform.test.ts:154 legacy-v1 crypto contract remains. Generic old per-row audit action is no longer a product contract; real current audit uses credentials.master_key_reencrypted.

Assertions to carry BEFORE deletion: live setup count helper pending and zero-after values (calculate AI+TypeSafe fixture subset, not11); deleted/null-secret exclusion if fixture expanded; malformed live AI ciphertext must still resolve as AiConnectionError(code='credential'), which is a distinct live read contract (place with platform connection resolution, not obsolete function). Keep/extend existing legacy-v1 crypto assertions; no need to assert obsolete per-row audit action. Retire reencryptAiConnectionSecrets and its obsolete comment; retain pendingReencryption/count helper. Coordinate typesafe.test.ts:356 deletion with research_runtime. Risk medium until count/credential-error assertions carried, low afterward. Focused validation: pnpm --filter @k5/web test tests/credential-rotation.test.ts tests/platform.test.ts tests/typesafe.test.ts. No mutation applied in discovery.

### C2 — retire generic mocked unknown-effect scenario after real network keepers absorb gaps (one)

Exact candidate: google-foundation.test.ts:125, 'resposta perdida mantém unknown e bloqueia envio equivalente com chave nova'. Actual failures: unknown status forgotten, duplicate action on same effect_key under fresh idempotency key, cross-capability collision bypass, same-key unknown replay re-executes. Non-test caller: Google Gmail/Drive/Calendar services all call runGoogleOperation. History184bf0b/85c21d1 introduced execution admission and effect-key dedupe. Synthetic spec's execute itself throws GoogleNetworkError and reconcile itself always declares unknown; stronger fake-network owner tests exercise real request/construction/reconciliation.

Keepers: google-gmail.test.ts:90 'envio tem Message-ID durável; resposta perdida mantém unknown e nova chave não reenvia'; :238 'mesmo rascunho com nova chave não é enviado duas vezes enquanto o resultado é desconhecido'; google-drive.test.ts:375 'efeito desconhecido de renomear bloqueia compartilhamento do mesmo arquivo'.

Assertions to carry BEFORE deletion: to Drive :375 repeat rename with SAME key and assert status unknown plus exactly one PATCH (this reaches operations.ts replay; Gmail uses a separate completedOrUnknown early path and is NOT enough); to Gmail :238 attempt deleteDraft on same unknown draft with a new key and assert CONFLICT/zero DELETE, enabling gmail.draft automatic to avoid irrelevant approval rejection. Existing draft fake GET supports this. Drive keeper already verifies cross-capability admission. Remove unused GoogleNetworkError import from foundation if no other usage. No production seam removed; spec is used by other valuable quota/approval/checkpoint tests and must stay. Risk medium before carry, low after meaningful no-second-write checks. Validate all google-foundation/google-gmail/google-drive tests together.

### C3 — consolidate platform origin predicate layer into real route (one)

Exact candidate: platform.test.ts:56, "writes require an allowed same origin". Actual failures: accepting foreign/subdomain/missing/malformed Origin, rejecting valid origin. Non-test callers: authorizePlatformRequest (platform routes) and feedback route. History platform security introduced before stronger real session/credential routes. Keeper: credential-rotation.test.ts:81 'real route requires a live platform session, same origin and the reviewed target key', plus platform-auth.test.ts:48 'papel de plataforma libera a API e a revogação vale na requisição seguinte'.

Assertions to carry BEFORE deletion: malformed Origin and different subdomain cases into real credentials POST while session/admin/body/next-key all valid, so no unrelated guard explains403; missing Origin already platform-auth handler covers it, valid same-origin body produces200. Test exact Portuguese cause only where independently product-facing; generic status sufficient at HTTP contract. No production seam unlocked; assertSameOrigin is used by production and stays. Risk low if guards exercised with authenticated valid mutation. Validate platform, platform-auth, credential-rotation tests. Avoid using auth-core signup tests as keeper: BetterAuth owns a different origin middleware.

### C4 — consolidate vault error serialization ownership (one)

Exact candidate: security.test.ts:375, "vault routes answer domain validation errors with 400 and the domain message". Actual failure: CapabilityError INVALID maps to wrong400/error/code JSON. Non-test callers: vault route modules call vaultErrorResponse; vault-api.ts explicitly branches CapabilityError separately from VaultHttpError. History34b75d8 preserved domain ptBR validation; observability suite later became canonical error-boundary guard. Keeper: vault-observability.test.ts:8 'vault failures reach Sentry without exposing private error messages; expected validation stays quiet'.

Assertions to carry BEFORE deletion: exact existing CapabilityError(Invalid) status and JSON into keeper, and assert Sentry count stays unchanged for it; existing VaultHttpError case alone is NOT duplicate coverage because different branch. Remove only now-unused vaultErrorResponse import from security. No production seam deletion. Risk low after carry. Focused validation: pnpm --filter @k5/web test tests/security.test.ts tests/vault-observability.test.ts. Coordinate keeper edit through root.

### Extra dead seam cut, zero executed-test reduction

Foundation :136 partial-effect checkpoint test is R: its ciphertext assertion is valuable. Delete only its assertion-free reencryptGoogleSecrets(testDb,parseCredentialKeyring()) tail and import. Repository-wide references show reencryptGoogleSecrets and googleSecretsNeedingReencryption have no non-test callers (latter only former's callee). Retire both exports/functions and now-unused CredentialKeyring/credentialNeedsReencryption imports from connections.ts. Current rotateCredentials keeper fixture covers Google tokens, verifier, operation args/result/checkpoint. It superseded these functions in4962212. Risk low; verify no remaining source/script callers and run Google foundation plus credentials rotation. No test-only state-injection transport/reset APIs removed: many retained meaningful fake-network tests still use them.

## Layer ownership and retained false positives

- Auth HTTP: auth.test.ts owns login/signup, global logout, expiry, rate limiting, CSRF. Keep all11; security requirement and actual BetterAuth boundary.
- Platform HTTP authorization: platform-auth and actual credential route own session-role-origin. Core role test remains R because it independently tests CLI grant return/idempotency and user lookup; do not pretend HTTP checks cover those.
- Crypto envelope/config: platform.test.ts:29/:154 and credential-rotation:37 are distinct protocol/config contracts, not redundant round trips.
- Rotation: authenticated route and credential-rotation own every live ciphertext; obsolete exports retire as C1. countSecretsNeedingReencryption remains setup contract.
- Google: OAuth/approval/quota/checkpoint/lifecycle remain foundation; HTTP send/draft and Drive own unknown-effect proof. Default-on regressions remain untouched. Four OAuth malformed/status table rows represent different failure-shape inputs; retain all4. Both stale object cleanup orderings retain distinct race windows.
- Agenda: capability/real database boundary retains CRM data, isolation, CAS and concurrent creation. SQL/CAS races are not covered by simple idempotency response tests.
- Notifications: functional polling-write avoidance guards a credible database-load regression. mark-all exact statement-count assertion is coupled, but declaration also independently protects cancellation cutoff and owner isolation; R, do not delete declaration to meet quota.
- Security: keep same-office colleague approval (agent-approvals test uses cross-office user); keep publicApproval fields as deliberate privacy DTO allowlist; keep custom ptBR schema issue because UI error handler depends on custom code. Pattern resemblance is not deletion evidence.
- PostgreSQL: keep all adapter/stream/lifecycle tests; callers include all routes/workers. Checksums CRLF test protects Windows operation, not source formatting trivia.

Retired files: none. Retired declarations: at most4 in this lane if required assertions are carried; plus1 TypeSafe declaration coordinated outside lane. High-confidence production-only dead seam cleanup does not change executed-case count. This is an upper bound, not an instruction to force all candidates or inflate count by concatenating unrelated tests. C1 (dead implementation) ranks first, C2 (real transport replaces mocked collaborator) second, C3/C4 boundary consolidation last.

## QA/support inventory

Owned Node test surface: all14 listed test files, 138 declarations (table rows expand beyond that). Shared support google-fixture.ts retained for real request fixtures; auth's postgres-fixture and test-setup owned centrally. No Google-specific live QA script found by scripts inventory. scripts/verify-workspace-ui.ts contains desktop calendar/task/client plus mobile and empty-state scenarios: retain all outside Node441 denominator; this is UI flow proof, not replaced by repository-service tests. Verify-workspace-ui is shared with the UI lane/root; its Google branch is absent. scripts/verify-staging.ts operational connections proof remains with root runtime owner. No QA deletion proposed.

Discovery completion: the initially sampled retained owner tails were subsequently read fully before cutover. Relevant history commits were inspected; no claim is made to reading every historical commit or unrelated transitive dependency. No additional R declaration is deletion-ready on this evidence. Mandatory independent preservation review and post-edit coverage comparison are root's next gates; no checks are claimed to have run in this lane.


## Applied cutover (root-authorized)

Applied C1-C4: four executed declarations removed, no files retired, all named keeper assertions carried. C1 removes old AI rotation export; TypeSafe old-test deletion is coordinated with research-runtime. Credential keeper now checks setup count 3 then 0 and an erased deleted AI row excluded; platform live resolution keeper rejects unreadable key without exposing its secret. C2 removes synthetic unknown executor case, carries same-key replay/no second PATCH to Drive and conflicting delete/no DELETE to Gmail with automatic draft permission set before the original send. C3 carries malformed and subdomain origins to authenticated staged-key route. C4 carries exact CapabilityError status/JSON/no-Sentry checks to vault-observability. Assertion-free Google rotation tail removed; old Google rotation and unused count export retired. countSecretsNeedingReencryption and its setup caller remain. Google rolloutFor pre-existing default-on changes preserved.

Changed files owned by lane: tests/platform.test.ts, credential-rotation.test.ts, google-foundation.test.ts, google-gmail.test.ts, google-drive.test.ts, security.test.ts, vault-observability.test.ts; src/lib/ai-connections-core.ts and google/connections.ts. Root owns focused/full tests, static checks and final coverage comparison. No commit or deployment performed.

## Final independent preservation review

Approved the final credential fixture repair after reading fixture, exact plaintext assertions and production rotation target list. Expected sentinels independently cover all eleven columns: AI key; office and platform TypeSafe keys; one-use secret; push subscription; Google refresh/access tokens; OAuth verifier; Google operation args/result/checkpoint. Each field is queried, required to contain exactly one nonempty ciphertext, decrypted using the new key alone, and compared to its distinct original plaintext. This detects dropped, swapped and corrupted plaintext in addition to new-key migration. Empty reference, erased AI row, setup counter, idempotency, rollback and safe audit checks remain. No unresolved preservation findings. Root reports targeted TypeSafe-platform plaintext mutation failed at exact comparison, 38 focused tests passed and production was restored; these executions were not performed by this reviewer.

The DJEN totalReported preservation gap is resolved by coverage.totalReported === 3 in the connector keeper. Root reports the zero-total mutation failed for 0 !== 3 and was restored. Final autoreview performed no tests or application/test edits; only this ledger note was written while root full coverage ran.
