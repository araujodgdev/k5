# Research/runtime lane audit

Read-only discovery; no source/tests edited or tests run by this lane. Baseline supplied by root: main 5e6ab96 plus existing Google default-access edits, 441 passing executed cases (435 declarations). All assigned test bodies and parameter loops read in full. Candidate owners/callers and relevant history inspected; conservative R marks do not authorize removal. CI is .github/workflows/ci.yml -> pnpm test -> scripts/test-postgres.ts; every retained *.test.ts remains auto-discovered. No live/paid QA run.

## tests/deploy-database.test.ts

Spawned real migration CLI against real read-only/admin PostgreSQL connections; independent deployment and append-only migration safety.

- **R** `tests/deploy-database.test.ts:33` — code-only deploy accepts the current schema through a read-only runtime connection despite expired admin credentials
  - Spawned real migration CLI against real read-only/admin PostgreSQL connections; independent deployment and append-only migration safety. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (2 assertions in inventory): `assert.equal(result.status, 0, result.output); / assert.match(result.output, /sem usar a credencial administrativa/);`
- **R** `tests/deploy-database.test.ts:40` — deploy blocks pending migrations with expired admin credentials and gives a safe recovery instruction
  - Spawned real migration CLI against real read-only/admin PostgreSQL connections; independent deployment and append-only migration safety. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (6 assertions in inventory): `assert.notEqual(result.status, 0); / assert.match(result.output, /0021_feedback_question.sql/);`
- **R** `tests/deploy-database.test.ts:52` — read-only preflight refuses missing or changed migrations without applying them
  - Spawned real migration CLI against real read-only/admin PostgreSQL connections; independent deployment and append-only migration safety. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.notEqual(missing.status, 0, missing.output); / assert.match(missing.output, /0021_feedback_question.sql/);`
- **R** `tests/deploy-database.test.ts:65` — deploy applies pending migrations only with the admin connection
  - Spawned real migration CLI against real read-only/admin PostgreSQL connections; independent deployment and append-only migration safety. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (2 assertions in inventory): `assert.equal(result.status, 0, result.output); / assert.equal((await f.pool.query("SELECT count(*) FROM postgres_migration WHERE name = '0021_feedback_question.sql'")).rows[0].count, '1');`
- **R** `tests/deploy-database.test.ts:73` — migration CLI rejects unknown flags instead of bypassing validation
  - Spawned real migration CLI against real read-only/admin PostgreSQL connections; independent deployment and append-only migration safety. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (2 assertions in inventory): `assert.notEqual(result.status, 0); / assert.match(result.output, /Argumento desconhecido/);`

## tests/indexing.test.ts

Real index publication/deletion/upload recovery boundary, with transport/backend platform contracts; flagged fake SQL race requires repair.

- **R** `tests/indexing.test.ts:64` — publication: a generation whose jobs did not all succeed does not replace a complete one
  - Real index publication/deletion/upload recovery boundary, with transport/backend platform contracts; flagged fake SQL race requires repair. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(await publishGenerationIfComplete(officeId, generationId), false, "a failed job blocks publication"); / assert.equal(await publishGenerationIfComplete(officeId, generationId), false, "a re-queued job still blocks");`
- **R** `tests/indexing.test.ts:91` — indexing: a job that exhausted its attempts while running reaches a terminal state
  - Real index publication/deletion/upload recovery boundary, with transport/backend platform contracts; flagged fake SQL race requires repair. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(row.status, "failed"); / assert.equal(row.leaseOwner, null);`
- **F** `tests/indexing.test.ts:114` — indexing: a worker that lost its lease cannot overwrite the outcome of the one that took it
  - Actual asserted race is SQL written IN THE TEST after processNextIndexJob already returned; this cannot catch loss of the production lease-owner predicate. Retain intended regression but repair at real worker boundary: inject delayed failing binding/provider, transfer lease in PostgreSQL while request pending, release failure, assert new owner/status unchanged. Prefer vectorize-contract failure boundary; must catch deliberate removal of production lease predicate. Do not delete counting this as redundant proof; no existing keeper proves this exact index owner race.
  - Assertion evidence (4 assertions in inventory): `assert.ok(["queued", "failed"].includes(own.status), "the lease holder records its own outcome"); / assert.equal(stale.changes, 0, "the guarded write matches nothing once the lease has moved on");`
- **R** `tests/indexing.test.ts:142` — uploads: a destination the server rejects does not cost the person their upload
  - Real index publication/deletion/upload recovery boundary, with transport/backend platform contracts; flagged fake SQL race requires repair. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `await assert.rejects( / assert.equal(after.consumedAt, null, "a failed ingestion releases the claim instead of burning it");`
- **R** `tests/indexing.test.ts:163` — deletion: a legacy flat name is removed and its queue entry closes
  - Real index publication/deletion/upload recovery boundary, with transport/backend platform contracts; flagged fake SQL race requires repair. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(await processNextDeletion(), true); / assert.ok(row.completedAt, "the entry closes instead of retrying a key that can never parse");`
- **R** `tests/indexing.test.ts:185` — deletion: a legacy removal that fails for a passing reason retries instead of closing
  - Real index publication/deletion/upload recovery boundary, with transport/backend platform contracts; flagged fake SQL race requires repair. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(await processNextDeletion(), true); / assert.equal(stalled.completedAt, null, "a transient failure leaves the entry open");`
- **R** `tests/indexing.test.ts:215` — vectorize: a scope wider than one filter batch is queried whole, not truncated
  - Real index publication/deletion/upload recovery boundary, with transport/backend platform contracts; flagged fake SQL race requires repair. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(seen.length, 2, "the scope is fanned out across requests"); / assert.deepEqual(seen.flat().sort(), [...documentIds].sort(), "every document in scope reaches the index");`
- **R** `tests/indexing.test.ts:257` — vectorize: an explicit backend never silently falls back to another index
  - Real index publication/deletion/upload recovery boundary, with transport/backend platform contracts; flagged fake SQL race requires repair. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (1 assertions in inventory): `await assert.rejects(() => vectorIndex(), /Vectorize/);`
- **R** `tests/indexing.test.ts:273` — vectorize: the Worker binding is preferred without REST credentials
  - Real index publication/deletion/upload recovery boundary, with transport/backend platform contracts; flagged fake SQL race requires repair. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(index.kind, "vectorize"); / assert.deepEqual(hits, [{ chunkId, score: 0.9 }]);`

## tests/judicial-connector.test.ts

Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above.

- **R** `tests/judicial-connector.test.ts:52` — connector registry: only implemented kinds resolve, and the rest say so plainly
  - Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(hasConnectorFor("djen"), true); / assert.equal(hasConnectorFor("mni"), false);`
- **R** `tests/judicial-connector.test.ts:65` — DJEN capabilities: declares what it does not do instead of staying silent
  - Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(capabilities.parserVersion, DJEN_PARSER_VERSION); / assert.equal(lookup?.supported, false, "DJEN publica comunicações, não os autos");`
- **C** `tests/judicial-connector.test.ts:81` — DJEN normalize: pure, and it separates the dates the court keeps apart
  - Actually detects fixture item count, CNJ normalization, two date fields and edition; self-equality is redundant. Non-test caller: createDjenConnector.listChanges -> collector. Keeper: DJEN listChanges: reports coverage of the window it actually walked. Carry first item cnjNumber/madeAvailableOn/publishedOn/edition and coverage.rejected into existing result assertions, remove repeat parser invocation/self-comparison. History: foundation 045a836. No production seam removed. Risk low after connector+pipeline focused run.
  - Assertion evidence (8 assertions in inventory): `assert.equal(parsed.items.length, 3); / assert.equal(parsed.rejected, 0);`
- **C** `tests/judicial-connector.test.ts:97` — DJEN normalize: an unverifiable number is not written to the CNJ column
  - Actually detects fixture third item null CNJ and retained legacy body. Non-test caller: listChanges -> collector. Keeper: DJEN listChanges: reports coverage of the window it actually walked; same three-item fixture already goes through actual connector. Carry result.items[2].cnjNumber===null and legacy body regex. History: foundation 045a836. Remove redundant parser invocation; no production seam. Risk low; connector+pipeline run.
  - Assertion evidence (2 assertions in inventory): `assert.equal(legacy.cnjNumber, null, "numeração legada não entra no índice CNJ"); / assert.match(legacy.body, /numeracao legada/i, "mas a publicação continua sendo coletada");`
- **R** `tests/judicial-connector.test.ts:104` — DJEN normalize: gazette markup becomes text, and the text is data, not instructions
  - Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(parsed.items[0].body.includes("<"), false, "o HTML do diário não é armazenado como markup"); / assert.match(parsed.items[0].body, /fls\. 12/);`
- **R** `tests/judicial-connector.test.ts:120` — DJEN normalize: an empty page is a real answer, a changed contract is not
  - Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.deepEqual(normalizeCommunications(fixture("djen-empty.json")), { items: [], rejected: 0, totalReported: 0 }); / assert.throws(`
- **R** `tests/judicial-connector.test.ts:134` — DJEN listChanges: reports coverage of the window it actually walked
  - Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (8 assertions in inventory): `assert.equal(result.items.length, 3); / assert.equal(result.coverage.pagesFetched, 1);`
- **R** `tests/judicial-connector.test.ts:149` — DJEN listChanges: refuses a window wider than the source documents
  - Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (1 assertions in inventory): `await assert.rejects(`
- **R** `tests/judicial-connector.test.ts:158` — DJEN listChanges: one request per linked proceeding, never a filterless sweep
  - Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (2 assertions in inventory): `assert.equal(result.coverage.pagesFetched, 2, "uma consulta por processo vinculado"); / assert.equal(result.items.length, 3);`
- **R** `tests/judicial-connector.test.ts:170` — DJEN listChanges: a list with no valid CNJ number is refused rather than widened
  - Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (2 assertions in inventory): `await assert.rejects( / await assert.rejects(`
- **R** `tests/judicial-connector.test.ts:184` — DJEN fetchPublication: preserves raw payload when response fails schema normalization
  - Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `await assert.rejects( / assert.equal(error.code, "schema_changed");`
- **R** `tests/judicial-connector.test.ts:203` — DJEN listChanges: source errors arrive as structured codes, with retryability decided
  - Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (2 assertions in inventory): `await assert.rejects( / assert.equal(isRetryable(code), retryable, '${code} retryable=${retryable}');`
- **R** `tests/judicial-connector.test.ts:222` — transport: live egress stays shut until a person opens it, even for an enabled source
  - Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (2 assertions in inventory): `await assert.rejects( / await assert.rejects(`
- **R** `tests/judicial-connector.test.ts:236` — transport: a host outside the installation allowlist is refused before any lookup
  - Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (1 assertions in inventory): `await assert.rejects(`
- **R** `tests/judicial-connector.test.ts:244` — transport: plain HTTP is refused even when the host is on the allowlist
  - Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (1 assertions in inventory): `await assert.rejects(`
- **R** `tests/judicial-connector.test.ts:252` — transport: a literal internal address never passes, allowlisted or not
  - Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (1 assertions in inventory): `await assert.rejects(`
- **R** `tests/judicial-connector.test.ts:264` — transport: the private-range classifier covers the addresses an SSRF actually aims at
  - Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(isPrivateAddress(address), true, '${address} deveria ser privado'); / assert.equal(isPrivateAddress(address), false, '${address} deveria ser público');`
- **R** `tests/judicial-connector.test.ts:280` — transport: a fixture is bound to the installation it was captured from
  - Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (1 assertions in inventory): `await assert.rejects(`
- **R** `tests/judicial-connector.test.ts:290` — permissions: each dimension is answered on its own and silence is not consent
  - Connector/transport public contracts: source parsing, explicit unsupported operations, pagination and SSRF authorization; same-named declaration remains primary owner unless marked above. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(permits(inst.permissions, "query"), true); / assert.equal(permits(inst.permissions, "cache"), true);`

## tests/judicial-normalization.test.ts

Shared external CNJ/date/publication identity contract. Keep meaningful format/precision/error/deduplication distinctions; only dead runtime helpers retired.

- **R** `tests/judicial-normalization.test.ts:15` — CNJ: accepts a well-formed number in every punctuation the sources use
  - Shared external CNJ/date/publication identity contract. Keep meaningful format/precision/error/deduplication distinctions; only dead runtime helpers retired. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(parsed.ok, true, 'deveria aceitar ${value}'); / assert.equal(parsed.normalized, VALID, "a forma normalizada é sempre os vinte dígitos");`
- **R** `tests/judicial-normalization.test.ts:25` — CNJ: the parts decompose as Resolução 65/2008 describes
  - Shared external CNJ/date/publication identity contract. Keep meaningful format/precision/error/deduplication distinctions; only dead runtime helpers retired. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(parsed.ok, true); / assert.deepEqual(parsed.parts, {`
- **R** `tests/judicial-normalization.test.ts:36` — CNJ: a single altered digit fails the check, so it never joins on the CNJ index
  - Shared external CNJ/date/publication identity contract. Keep meaningful format/precision/error/deduplication distinctions; only dead runtime helpers retired. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(parsed.ok, false); / assert.equal(parsed.reason, "check_digits");`
- **R** `tests/judicial-normalization.test.ts:46` — CNJ: malformed inputs are rejected with the reason, never coerced
  - Shared external CNJ/date/publication identity contract. Keep meaningful format/precision/error/deduplication distinctions; only dead runtime helpers retired. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.deepEqual(parseCnjNumber("123"), { ok: false, reason: "length" }); / assert.deepEqual(parseCnjNumber("0000001-05.2025.8.26.010"), { ok: false, reason: "length" });`
- **D** `tests/judicial-normalization.test.ts:55` — CNJ: a legacy number survives as native identity instead of being dropped or promoted
  - Actually detects only the unused toCaseIdentity wrapper mapping. Non-test callers: none (rg across src/scripts); real judicial-service.linkJudicialCase parses directly. Keeper: judicial-pipeline / linking: an unverifiable number is kept as native identity, not rejected; linking: a proposed link never starts confirmed, whoever proposed it. History: judicial foundation 045a836. Remove toCaseIdentity and Degree import. Risk low: no runtime callers; run judicial normalization/pipeline.
  - Assertion evidence (5 assertions in inventory): `assert.equal(legacy.cnjNumber, null, "um número que não valida nunca entra na coluna CNJ"); / assert.equal(legacy.nativeNumber, "583.00.2011.123456-7", "mas continua sendo uma identidade real");`
- **D** `tests/judicial-normalization.test.ts:66` — CNJ: the routing hint reports the court digits without linking anything automatically
  - Actually detects slicing inside unused cnjRoutingHint; cannot detect automatic linking. Non-test callers: none. No current runtime contract; judicial service directly uses parseCnjNumber. History: unused foundation 045a836 helper. Remove cnjRoutingHint and unused VALID_OTHER fixture. Risk low after typecheck/caller search; run judicial normalization/pipeline.
  - Assertion evidence (3 assertions in inventory): `assert.deepEqual(cnjRoutingHint(VALID), { segment: "8", court: "26" }); / assert.deepEqual(cnjRoutingHint(VALID_OTHER), { segment: "8", court: "13" });`
- **R** `tests/judicial-normalization.test.ts:72` — dates: a date with no time never acquires one
  - Shared external CNJ/date/publication identity contract. Keep meaningful format/precision/error/deduplication distinctions; only dead runtime helpers retired. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.deepEqual(brazilian, { value: "2025-03-12", precision: "date", timezone: null }); / assert.deepEqual(iso, { value: "2025-03-12", precision: "date", timezone: null });`
- **R** `tests/judicial-normalization.test.ts:84` — dates: precision and timezone are preserved exactly as the source wrote them
  - Shared external CNJ/date/publication identity contract. Keep meaningful format/precision/error/deduplication distinctions; only dead runtime helpers retired. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.deepEqual(parseSourceDate("2026-09-10T14:32:00-03:00"), { / assert.deepEqual(parseSourceDate("2026-09-10T14:32Z"), {`
- **R** `tests/judicial-normalization.test.ts:97` — dates: an unparseable or impossible value is rejected rather than guessed
  - Shared external CNJ/date/publication identity contract. Keep meaningful format/precision/error/deduplication distinctions; only dead runtime helpers retired. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (8 assertions in inventory): `assert.equal(parseSourceDate("31/02/2025"), null, "30 de fevereiro não existe"); / assert.equal(parseSourceDate("2025-13-01"), null);`
- **R** `tests/judicial-normalization.test.ts:108` — windows: the refresh window overlaps the watermark so a late publication is not skipped
  - Shared external CNJ/date/publication identity contract. Keep meaningful format/precision/error/deduplication distinctions; only dead runtime helpers retired. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.deepEqual(window, { from: "2026-09-08", to: "2026-09-12" }); / assert.equal(windowDays(window.from, window.to), 5, "a janela é inclusiva nas duas pontas");`
- **D** `tests/judicial-normalization.test.ts:126` — fingerprints: a movement code and its date alone do not identify an event
  - Actually detects movementFingerprint digest varying with sourceText. Non-test callers: none; implemented connector only collects publications. No current runtime owner for movement ingestion. History: prospective foundation 045a836. Remove movementFingerprint and movement fixture/NormalizedMovement imports with sibling declaration below; retain publicationFingerprint. Risk: future movement feature must add its own boundary contract; run judicial normalization/pipeline.
  - Assertion evidence (2 assertions in inventory): `assert.notEqual(first.value, second.value); / assert.equal(first.strategy, "stable_fields");`
- **D** `tests/judicial-normalization.test.ts:135` — fingerprints: the source identity wins when there is one, and whitespace never splits a row
  - Actually detects unused movementFingerprint source-id preference and whitespace normalization. Non-test callers: none. No runtime movement path; publication normalization remains independently covered. History: prospective foundation 045a836. Remove movementFingerprint/fixture with preceding declaration. Risk low for current app; run judicial normalization/pipeline.
  - Assertion evidence (3 assertions in inventory): `assert.equal(withId.strategy, "source_id"); / assert.equal(withId.value, movementFingerprint(movement({ sourceMovementId: "mov-9", sourceText: "texto diferente" })).value);`
- **R** `tests/judicial-normalization.test.ts:153` — fingerprints: an errata is a different row from the publication it corrects
  - Shared external CNJ/date/publication identity contract. Keep meaningful format/precision/error/deduplication distinctions; only dead runtime helpers retired. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (2 assertions in inventory): `assert.notEqual(original.value, errata.value); / assert.notEqual(byId.value, byIdErrata.value, "a versão participa da identidade mesmo com id da fonte");`
- **R** `tests/judicial-normalization.test.ts:164` — fingerprints: the official hash outranks derived fields when the court publishes one
  - Shared external CNJ/date/publication identity contract. Keep meaningful format/precision/error/deduplication distinctions; only dead runtime helpers retired. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (2 assertions in inventory): `assert.equal(hashed.strategy, "source_id"); / assert.equal(hashed.value, publicationFingerprint(publication({ officialHash: "abc123", body: "outro texto" })).value);`
- **R** `tests/judicial-normalization.test.ts:171` — alerts: the dedupe key is stable for the same event and distinct across kinds
  - Shared external CNJ/date/publication identity contract. Keep meaningful format/precision/error/deduplication distinctions; only dead runtime helpers retired. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(alertDedupeKey("new_publication", "publication", "p1"), alertDedupeKey("new_publication", "publication", "p1")); / assert.notEqual(alertDedupeKey("new_publication", "publication", "p1"), alertDedupeKey("historical_publication", "publication", "p1"));`

## tests/judicial-pipeline.test.ts

Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery.

- **R** `tests/judicial-pipeline.test.ts:129` — catalog: every judicial capability has an executor and a sane publication policy
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(judicialNames.length, 12); / assert.equal(lawyerTools.includes("k5_judicial_confirm_link"), true);`
- **R** `tests/judicial-pipeline.test.ts:148` — linking: a proposed link never starts confirmed, whoever proposed it
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (6 assertions in inventory): `assert.equal(result.created, true); / assert.equal(result.numberKind, "cnj");`
- **R** `tests/judicial-pipeline.test.ts:168` — linking: an unverifiable number is kept as native identity, not rejected
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(result.numberKind, "native"); / assert.equal(result.link.cnjNumber, null);`
- **R** `tests/judicial-pipeline.test.ts:180` — isolation: a case from another office is not linkable and its links are invisible
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `await assert.rejects( / assert.equal(seenByA.links.some((item) => item.id === link.id), false, "vínculo de outro escritório não aparece");`
- **R** `tests/judicial-pipeline.test.ts:207` — links: unfiltered listings are bounded and the cursor advances without overlap
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (8 assertions in inventory): `assert.equal(defaultPage.links.length, 20); / assert.equal(typeof defaultPage.nextCursor, "string");`
- **R** `tests/judicial-pipeline.test.ts:238` — inbox filters run before limits and collection state survives a reload
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (11 assertions in inventory): `assert.equal(alerts.alerts.length, 1); / assert.equal(alerts.alerts[0]?.caseId, caseA);`
- **R** `tests/judicial-pipeline.test.ts:311` — refresh: an unconfirmed link cannot spend a request against a court
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `await assert.rejects( / assert.equal(queued.created, true);`
- **R** `tests/judicial-pipeline.test.ts:335` — refresh: a source whose terms are unclear is not collected from
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (1 assertions in inventory): `await assert.rejects(`
- **R** `tests/judicial-pipeline.test.ts:349` — collection: originals, publications and alerts land together and a replay adds nothing
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (11 assertions in inventory): `assert.equal(first?.status, "completed"); / assert.equal(first?.inserted, 3);`
- **R** `tests/judicial-pipeline.test.ts:389` — collection: the minimum spacing turns away a second sweep instead of asking the court twice
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal((await processNextJudicialJob())?.status, "completed"); / assert.equal(throttled?.jobId, second.id);`
- **F** `tests/judicial-pipeline.test.ts:408` — collection: a backfill finding announces history, not news from today
  - Real collector runs; alerts.every alone passes for empty list. Assert nonzero/exact three alerts before every to make claimed historical alert delivery observable. Keep regression; do not count as deletion.
  - Assertion evidence (2 assertions in inventory): `assert.equal(outcome?.status, "completed"); / assert.equal(alerts.alerts.every((alert) => alert.eventKind === "historical_publication"), true);`
- **R** `tests/judicial-pipeline.test.ts:431` — collection: an errata is a new version related to the original, never an overwrite
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (6 assertions in inventory): `assert.equal(outcome?.inserted, 1); / assert.equal(rows.length, 1);`
- **R** `tests/judicial-pipeline.test.ts:467` — collection: two offices tracking the same proceeding keep separate evidence
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(forA.publications.length, 3); / assert.equal(forB.publications.length, 3);`
- **R** `tests/judicial-pipeline.test.ts:496` — evidence: an opened publication carries its origin and is labelled untrusted
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(list.untrustedContent, true); / assert.equal(opened.untrustedContent, true);`
- **R** `tests/judicial-pipeline.test.ts:523` — queue: a lease is exclusive, and an exhausted job stops instead of looping
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (8 assertions in inventory): `assert.equal(first?.job.id, job.id); / assert.equal(first?.job.attempts, 1);`
- **R** `tests/judicial-pipeline.test.ts:552` — queue: a rejected credential stops the subscription instead of retrying forever
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(claimed?.job.id, job.id); / assert.equal(outcome.retrying, false, "credencial recusada não é condição transitória");`
- **R** `tests/judicial-pipeline.test.ts:574` — queue: a changed schema is quarantined, a rate limit is rescheduled
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal((await findJob(officeA, quarantined.id))?.status, "quarantined"); / assert.equal(outcome.retrying, true);`
- **R** `tests/judicial-pipeline.test.ts:594` — budget: the daily ceiling and the minimum spacing are enforced in the database
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (6 assertions in inventory): `assert.deepEqual(await reserveRequestBudget(officeA, shape, now), { allowed: true }); / assert.equal(spaced.allowed, false);`
- **R** `tests/judicial-pipeline.test.ts:612` — scheduler: a subscription with nothing confirmed asks the court nothing
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.match(mine?.reason ?? "", /aguarda confirmação/); / assert.equal(outcome.queued, 0, "nenhuma consulta é enviada a um tribunal por um vínculo não confirmado");`
- **R** `tests/judicial-pipeline.test.ts:637` — scheduler: losing the membership that authorized a subscription suspends it
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.deepEqual(await subscriptionStillAuthorized((await findSubscriptionById(subscription.id))!), { ok: true }); / assert.equal(revoked.ok, false);`
- **R** `tests/judicial-pipeline.test.ts:657` — subscriptions: active retries preserve notification opt-outs; reactivation restores following
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(await activeFollowers(), 1); / assert.equal(await activeFollowers(), 0);`
- **R** `tests/judicial-pipeline.test.ts:675` — unlinking: collection stops and the evidence already gathered is kept
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(await unlinkCase(officeA, link.id), true); / assert.equal((await findSubscriptionById(subscription.id))?.status, "cancelled", "a autorização recorrente cai junto");`
- **R** `tests/judicial-pipeline.test.ts:701` — authorization: a reviewer reads judicial data and writes none of it
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (2 assertions in inventory): `assert.equal(Array.isArray(read.links), true); / await assert.rejects(`
- **R** `tests/judicial-pipeline.test.ts:722` — authorization: a membership revoked mid-turn stops the next judicial write
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (1 assertions in inventory): `await assert.rejects(`
- **R** `tests/judicial-pipeline.test.ts:737` — durability: a job completed by its lease holder cannot be completed twice
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(await completeJob(job.id, claimed.leaseOwner), true); / assert.equal(await completeJob(job.id, claimed.leaseOwner), false);`
- **R** `tests/judicial-pipeline.test.ts:750` — collector: malformed upstream response is preserved in judicial_snapshot when job is quarantined
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(outcome?.status, "quarantined"); / assert.equal((await findJob(officeA, job.id))?.status, "quarantined");`
- **R** `tests/judicial-pipeline.test.ts:782` — provenance: publications across multiple pages/responses retain their respective matching snapshot ID
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(outcome.snapshotIds.length, 2); / assert.notEqual(outcome.snapshotIds[0], outcome.snapshotIds[1]);`
- **R** `tests/judicial-pipeline.test.ts:868` — scheduler: an individual case subscription schedules collection only for that case's linked CNJ
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(outcome.queued, 1); / assert.deepEqual(parsedRequest.cnjNumbers, [VALID], "apenas o CNJ vinculado a esta assinatura deve ser consultado");`
- **R** `tests/judicial-pipeline.test.ts:892` — collector: budget is reserved and enforced for each physical transport request
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(await requestsUsedToday(officeA, installation.id), 2); / assert.equal(outcome2?.status, "retrying");`
- **R** `tests/judicial-pipeline.test.ts:931` — collector: configured spacing above ten seconds is awaited between requests
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(outcome?.status, "completed"); / assert.equal(waits.some((delay) => delay > 10_000), true);`
- **R** `tests/judicial-pipeline.test.ts:974` — collector: a worker that loses its lease stops before persistence or completion
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(outcome?.status, "skipped"); / assert.equal(replacement?.job.id, job.id);`
- **R** `tests/judicial-pipeline.test.ts:1013` — evidence: an oversized response rejects the transaction and does not write a synthetic storage key
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (2 assertions in inventory): `await assert.rejects( / assert.equal(snapshotCount.count, 0, "nenhum snapshot deve ser persistido quando excede o limite");`
- **R** `tests/judicial-pipeline.test.ts:1049` — cross-case isolation: publications belonging to another confirmed case resolve to that case link rather than the job's fallback link
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(outcome.inserted, 2); / assert.equal(pubA.link_id, linkA.id, "publicação do caso A deve ser atribuída ao linkA");`
- **R** `tests/judicial-pipeline.test.ts:1122` — scheduler: scheduleBackfill rejects unconfirmed case link rather than doing an unauthorized broad sweep
  - Real PostgreSQL capability/collector/scheduler evidence: office isolation, human authorization, durable provenance, queue leases, budgets and retry delivery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (1 assertions in inventory): `await assert.rejects(`

## tests/judicial-transport.test.ts

Real liveTransport request formation through https fake server response; independent JSON content-type interoperability regression.

- **R** `tests/judicial-transport.test.ts:8` — judicial transport sends a JSON content type so the source applies the thematic query
  - Real liveTransport request formation through https fake server response; independent JSON content-type interoperability regression. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (2 assertions in inventory): `assert.deepEqual(JSON.parse(receivedBody), body); / assert.equal(JSON.parse(response.body).query, body.query);`

## tests/observability.test.ts

Privacy/configuration/error instrumentation: stack data kept while request secrets/SQL/prompt data stripped; invocation default regression real DB claim.

- **R** `tests/observability.test.ts:10` — observed worker preserves the task default argument before a PostgreSQL claim
  - Privacy/configuration/error instrumentation: stack data kept while request secrets/SQL/prompt data stripped; invocation default regression real DB claim. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (1 assertions in inventory): `assert.equal(row?.owner, 'expected-worker');`
- **R** `tests/observability.test.ts:19` — telemetry is opt-in in development/test, enabled in staging, and can be disabled
  - Privacy/configuration/error instrumentation: stack data kept while request secrets/SQL/prompt data stripped; invocation default regression real DB claim. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (9 assertions in inventory): `assert.equal(serverOptions('web', {}).enabled, false); / assert.equal(serverOptions('web', { NODE_ENV: 'test' }).enabled, false);`
- **R** `tests/observability.test.ts:31` — error events keep stack locations but discard request and office data
  - Privacy/configuration/error instrumentation: stack data kept while request secrets/SQL/prompt data stripped; invocation default regression real DB claim. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (7 assertions in inventory): `assert.deepEqual(safe.request, { method: 'POST', url: 'https://lume.test/api/chat' }); / assert.equal(safe.user, undefined);`
- **R** `tests/observability.test.ts:52` — breadcrumbs and traces discard console content, SQL literals and AI prompts
  - Privacy/configuration/error instrumentation: stack data kept while request secrets/SQL/prompt data stripped; invocation default regression real DB claim. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (6 assertions in inventory): `assert.equal(beforeBreadcrumb({ category: 'console', message: 'private' }), null); / assert.equal(beforeBreadcrumb({ category: 'ui.click', message: 'client@example.com' }), null);`

## tests/preview-config.test.ts

Public preview configuration isolation and path/TLS validation contract; static/config shape is meaningful, not deletable for looking implementation-like.

- **R** `tests/preview-config.test.ts:11` — preview migration rejects a main-branch role, unsafe TLS and connection overrides
  - Public preview configuration isolation and path/TLS validation contract; static/config shape is meaningful, not deletable for looking implementation-like. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (1 assertions in inventory): `assert.throws(() => validateDatabaseUrl(url, profile), /Conexão recusada/);`
- **R** `tests/preview-config.test.ts:19` — preview profiles cannot silently point to shared staging storage
  - Public preview configuration isolation and path/TLS validation contract; static/config shape is meaningful, not deletable for looking implementation-like. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (1 assertions in inventory): `assert.throws(() => validateProfile({ ...profile, ...override }, 'example'), /exclusivamente/);`
- **R** `tests/preview-config.test.ts:26` — preview build has isolated HTTP bindings and no background or cross-Worker bindings
  - Public preview configuration isolation and path/TLS validation contract; static/config shape is meaningful, not deletable for looking implementation-like. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (6 assertions in inventory): `assert.equal(config.previews.hyperdrive[0].id, profile.hyperdriveId); / assert.equal(config.previews.vars.PROCESSORS_ENABLED, 'false');`
- **R** `tests/preview-config.test.ts:38` — branch-derived names are stable, collision resistant and safe for paths
  - Public preview configuration isolation and path/TLS validation contract; static/config shape is meaningful, not deletable for looking implementation-like. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(previewName('codex/test'), previewName('codex/test')); / assert.notEqual(previewName('codex/test'), previewName('codex-test'));`

## tests/processors.test.ts

Private object transport byte integrity/host validation and actual due queue/lease wakeup policy.

- **R** `tests/processors.test.ts:8` — private container bridge preserves object bytes and rejects invalid keys and public hosts
  - Private object transport byte integrity/host validation and actual due queue/lease wakeup policy. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (6 assertions in inventory): `assert.equal((await processorBindingRequest(new Request(url, { method: 'PUT', body: bytes }), env)).status, 204); / assert.deepEqual(new Uint8Array(await (await processorBindingRequest(new Request(url), env)).arrayBuffer()), bytes);`
- **R** `tests/processors.test.ts:29` — processor scheduling wakes due queues, recovers expired leases and leaves empty containers asleep
  - Private object transport byte integrity/host validation and actual due queue/lease wakeup policy. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (6 assertions in inventory): `assert.deepEqual(await dueProcessors(db, now, false), { documents: false, judicial: false }); / assert.deepEqual(await dueProcessors(db, now, true), { documents: true, judicial: false });`

## tests/pwa.test.ts

Executed service-worker event boundary in VM. Independent privacy/cache/activation/update/push behavior; browser harness adds genuine lifecycle evidence.

- **R** `tests/pwa.test.ts:18` — PWA: startup and subscription changes recover the current subscription without a window
  - Executed service-worker event boundary in VM. Independent privacy/cache/activation/update/push behavior; browser harness adds genuine lifecycle evidence. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (1 assertions in inventory): `assert.deepEqual(sw.uploads, [{ ...authorization, endpoint: 'https://push.test/new', expirationTime: null,`
- **R** `tests/pwa.test.ts:28` — PWA: recovery preserves client notifications and never enrolls revoked devices
  - Executed service-worker event boundary in VM. Independent privacy/cache/activation/update/push behavior; browser harness adds genuine lifecycle evidence. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (2 assertions in inventory): `assert.deepEqual(messages, [{ type: 'K5_PUSH_SUBSCRIPTION_CHANGED' }]); / assert.deepEqual(sw.uploads, []);`
- **R** `tests/pwa.test.ts:146` — PWA: install caches only the public offline screen and icons; activation preserves other apps
  - Executed service-worker event boundary in VM. Independent privacy/cache/activation/update/push behavior; browser harness adds genuine lifecycle evidence. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (7 assertions in inventory): `assert.equal(sw.cached.size, 5); / assert.ok([...sw.cached.keys()].every((key) => key === "/offline.html" || key.startsWith("/icons/")));`
- **R** `tests/pwa.test.ts:160` — PWA: the precached offline screen survives a host redirect
  - Executed service-worker event boundary in VM. Independent privacy/cache/activation/update/push behavior; browser harness adds genuine lifecycle evidence. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (2 assertions in inventory): `assert.equal(sw.cached.get("/offline.html")!.redirected, false); / assert.equal(await (await sw.fetch("/app", "navigate"))?.text(), "/offline.html");`
- **R** `tests/pwa.test.ts:170` — PWA: accepted update keeps old-tab chunks available after the deployment removes them
  - Executed service-worker event boundary in VM. Independent privacy/cache/activation/update/push behavior; browser harness adds genuine lifecycle evidence. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(response?.status, 200, "an old tab must still be able to load its cached chunk"); / assert.equal(await response?.text(), "network");`
- **R** `tests/pwa.test.ts:191` — PWA: retained caches cannot supply stale offline pages or other apps' assets
  - Executed service-worker event boundary in VM. Independent privacy/cache/activation/update/push behavior; browser harness adds genuine lifecycle evidence. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(await (await next.fetch("/icons/icon-192.png"))?.text(), "network"); / assert.equal(await (await next.fetch("/_next/static/foreign.js"))?.text(), "network");`
- **R** `tests/pwa.test.ts:207` — PWA: private HTML always reaches the server and never enters Cache Storage
  - Executed service-worker event boundary in VM. Independent privacy/cache/activation/update/push behavior; browser harness adds genuine lifecycle evidence. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(await (await sw.fetch(route, "navigate"))?.text(), "network"); / assert.equal(sw.networkCalls, 4);`
- **R** `tests/pwa.test.ts:218` — PWA: disconnected navigation has a public fallback, never stale office data
  - Executed service-worker event boundary in VM. Independent privacy/cache/activation/update/push behavior; browser harness adds genuine lifecycle evidence. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (2 assertions in inventory): `assert.equal(await (await sw.fetch("/app/vault", "navigate"))?.text(), "/offline.html"); / assert.equal((await sw.fetch("/app", "navigate"))?.status, 503);`
- **R** `tests/pwa.test.ts:227` — PWA: APIs, downloads, actions, RSC and foreign requests bypass the worker
  - Executed service-worker event boundary in VM. Independent privacy/cache/activation/update/push behavior; browser harness adds genuine lifecycle evidence. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (6 assertions in inventory): `for (const path of paths) assert.equal(await sw.fetch(path), undefined); / assert.equal(await sw.fetch("/api/vault/documents/1/download", "navigate"), undefined);`
- **R** `tests/pwa.test.ts:238` — PWA: errors and private responses cannot poison the public asset cache
  - Executed service-worker event boundary in VM. Independent privacy/cache/activation/update/push behavior; browser harness adds genuine lifecycle evidence. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (1 assertions in inventory): `assert.equal(sw.cached.size, 0);`
- **C** `tests/pwa.test.ts:248` — PWA: public assets can be reused offline
  - Actually detects first fetch cached and same-version cache hit survives offline. Non-test owner: generated service-worker fetch listener. Keeper: PWA: accepted update keeps old-tab chunks available after the deployment removes them already warms JS/CSS and proves offline retrieval across releases. Carry same-version cache-hit assertion before update: after warm-up set old offline, re-fetch old JS, assert text network and old.networkCalls===2. Only old worker becomes offline; new worker independently serves later actions. History: PWA foundation and later update regression d86e3b8. No seam; PWA suite (retain verify-pwa/update harnesses).
  - Assertion evidence (4 assertions in inventory): `assert.equal(await (await sw.fetch("/_next/static/app.js"))?.text(), "network"); / assert.equal(sw.cached.size, 1);`
- **R** `tests/pwa.test.ts:257` — PWA: push shows only generic copy, notifies tabs, and opens the guarded route
  - Executed service-worker event boundary in VM. Independent privacy/cache/activation/update/push behavior; browser harness adds genuine lifecycle evidence. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (7 assertions in inventory): `assert.equal(sw.notifications.length, 1); / assert.equal(sw.notifications[0].title, "Lume");`

## tests/research-capabilities.test.ts

Actual publication and invocation policy, owner-private history and HTTP transport privacy.

- **R** `tests/research-capabilities.test.ts:18` — somente leituras de acervo, julgado e referências são publicadas
  - Actual publication and invocation policy, owner-private history and HTTP transport privacy. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (6 assertions in inventory): `assert.deepEqual(publishedCapabilitiesForRole('lawyer', 'agent').filter(name => capabilities[name].module === 'research'), ['k5_research_web_jurisprudence', ...names]); / assert.deepEqual(publishedCapabilitiesForRole('lawyer', 'webmcp').filter(name => capabilities[name].module === 'research'), names);`
- **R** `tests/research-capabilities.test.ts:31` — invocação de agente não burla publicação e revisor não inicia pesquisa
  - Actual publication and invocation policy, owner-private history and HTTP transport privacy. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `await assert.rejects( / await assert.rejects(`
- **R** `tests/research-capabilities.test.ts:48` — pesquisa fica no autor e chave idempotente não aceita outro tema
  - Actual publication and invocation policy, owner-private history and HTTP transport privacy. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(started.search.id, repeated.search.id); / await assert.rejects(runCapability(a, 'k5_research_start_search', { ...input, theme: 'alimentos', idempotencyKey }), { code: 'CONFLICT' });`
- **R** `tests/research-capabilities.test.ts:62` — tema privado segue no corpo do POST de busca do acervo
  - Actual publication and invocation policy, owner-private history and HTTP transport privacy. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(result.ok, true); / assert.equal(url, '/api/research/corpus');`

## tests/research-case.test.ts

Case profile/evidence/reference isolation and versioned TypeSafe decisions; direct composition rules have independent scoring/adequacy semantics.

- **R** `tests/research-case.test.ts:14` — trecho de jurisprudência selecionado pode ser citado sem palavra-chave no texto
  - Case profile/evidence/reference isolation and versioned TypeSafe decisions; direct composition rules have independent scoring/adequacy semantics. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(research.length, 1); / assert.equal(research[0].text, text);`
- **R** `tests/research-case.test.ts:83` — profile versions, per-fact evidence, reviewer and office isolation
  - Case profile/evidence/reference isolation and versioned TypeSafe decisions; direct composition rules have independent scoring/adequacy semantics. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (8 assertions in inventory): `assert.equal(await getResearchCaseProfile(a.context, a.caseId), null); / await assert.rejects(saveResearchCaseProfile(a.context, { ...profileInput(a), documentedFacts: [{ text: 'Fato externo', documentIds: [b.documentId], chunkIds: [] }] }), { code: 'INVALID' });`
- **R** `tests/research-case.test.ts:95` — queued assessment keeps stance apart from relevance and invalidates changed evidence
  - Case profile/evidence/reference isolation and versioned TypeSafe decisions; direct composition rules have independent scoring/adequacy semantics. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (10 assertions in inventory): `assert.equal(queued.status, 'queued'); / assert.equal(await processNextResearchAssessment({ send: sendOpposes }), true);`
- **R** `tests/research-case.test.ts:118` — explicit bypass, idempotent link, pinned historical citation and office boundaries
  - Case profile/evidence/reference isolation and versioned TypeSafe decisions; direct composition rules have independent scoring/adequacy semantics. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (19 assertions in inventory): `assert.equal(disabled.status, 'disabled'); / await assert.rejects(addResearchCaseReference(a.context, { caseId: a.caseId, materialVersionId: material.versionId,`
- **R** `tests/research-case.test.ts:162` — composition requires adequate evidence and never rewards thesis position
  - Case profile/evidence/reference isolation and versioned TypeSafe decisions; direct composition rules have independent scoring/adequacy semantics. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(Object.keys(researchAssessmentQuestions(false)).includes('stance'), false); / assert.equal(composeResearchAssessment(scores), 1);`
- **R** `tests/research-case.test.ts:173` — research rerank uses its own mode and private versioned cache
  - Case profile/evidence/reference isolation and versioned TypeSafe decisions; direct composition rules have independent scoring/adequacy semantics. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (11 assertions in inventory): `assert.equal(first.applied, false); assert.deepEqual(first.candidates, candidates); / assert.equal((await rerankResearchResults(a.context, 'guarda à avó', candidates, { send })).status, 'evaluated');`
- **R** `tests/research-case.test.ts:205` — reference update changes only its pinned version; exhausted leases terminate
  - Case profile/evidence/reference isolation and versioned TypeSafe decisions; direct composition rules have independent scoring/adequacy semantics. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (6 assertions in inventory): `await assert.rejects(updateResearchCaseReference(a.context, { referenceId: oldLink.id, expectedVersion: oldLink.version, / assert.equal(updated.materialVersionId, newVersionId);`

## tests/research-core.test.ts

Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization.

- **R** `tests/research-core.test.ts:28` — originais públicos usam o binding R2 compartilhado e verificam integridade
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.deepEqual(await getResearchOriginal(key),bytes); / await assert.rejects(getResearchOriginal(key),/corrompido/);`
- **R** `tests/research-core.test.ts:69` — TJDFT normaliza hits.value, quarentena sem identidade e placeholder apesar da flag
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(page.records[0].fullText,null); / assert.equal(page.records[0].fullTextStatus,'unavailable');`
- **R** `tests/research-core.test.ts:79` — duas pessoas compartilham identidade pública e não histórico privado
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(id,again); / assert.ok(corpusA.results.some((item)=>item.id===id));`
- **R** `tests/research-core.test.ts:94` — revisões opacas do TJDFT sobrevivem à publicação e atualização no PostgreSQL
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal((await testDb.prepare('SELECT source_updated_at FROM research_judgment WHERE id=?').get(id))!.source_updated_at, '0001'); / assert.equal(revisions.length, 2);`
- **R** `tests/research-core.test.ts:114` — FTS pesquisa além dos 400 mais recentes e pagina sem repetir IDs
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(old.results[0]?.id,entries[0][0]); / assert.equal(first.results.length,20);`
- **F** `tests/research-core.test.ts:148` — página externa persiste antes de exibir e replay de cursor não dispara nova página
  - Persistence/placeholder assertions are useful. Cursor replay assertions are conditional, but fixture hits=1 yields no cursor: promised replay is not exercised. Keep persistence contract; adjust name or use real multi-page fixture and require non-null cursor before replay. Do not delete this owner-boundary case.
  - Assertion evidence (5 assertions in inventory): `assert.equal(started.pages[0].status,'queued'); / assert.equal(outcome?.status,'completed');`
- **R** `tests/research-core.test.ts:169` — repetir coleta mantém versão e IDs de trechos; alteração cria versão sem apagar a antiga
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal((await testDb.prepare('SELECT id FROM research_chunk WHERE material_version_id=?').get(first.id))!.id,firstChunk); / assert.equal((await testDb.prepare('SELECT count(*) AS n FROM research_material_version WHERE material_id=?').get(first.material_id))!.n,1);`
- **R** `tests/research-core.test.ts:187` — obtenção automática alcança só o material da página visitada e publica texto válido
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(started.pages[0].results.some((item)=>item.id===judgmentId),true); / assert.equal((await testDb.prepare("SELECT count(*) AS n FROM research_job WHERE material_id=? AND status='queued'").get(material.id))!.n,1);`
- **R** `tests/research-core.test.ts:206` — reserva de quota é atômica e lease expirado após cinco tentativas termina
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `await assert.rejects(debitResearchRequest(limited,person.officeId),/Limite/); / assert.equal((await testDb.prepare('SELECT status FROM research_job WHERE id=?').get(job.id))!.status,'failed');`
- **R** `tests/research-core.test.ts:223` — lease roubado durante transporte impede publicação e não sobrescreve outro worker
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(outcome?.status,'stale'); / assert.equal((await testDb.prepare('SELECT count(*) AS n FROM research_judgment WHERE source_judgment_id=?').get(native))!.n,0);`
- **R** `tests/research-core.test.ts:259` — PDF binário preserva bytes/hash e o worker publica texto extraído por página
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (7 assertions in inventory): `assert.deepEqual(downloaded.bytes,bytes); / assert.equal(await processNextResearchExtraction(),true);`
- **R** `tests/research-core.test.ts:287` — Worker sem bindings compartilhados recusa original antes do filesystem
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (6 assertions in inventory): `assert.ok(row?.current_version_id); / assert.match(Buffer.from((await getResearchOriginalForUser(person,row.current_version_id)).bytes).toString('utf8'),/AMOSTRA DE TESTE/);`
- **R** `tests/research-core.test.ts:314` — 21 materiais locais pendentes enfileiram só os 20 exibidos; próxima ação obtém o 21º
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(started.pages[0].results.length,20); / assert.equal((await testDb.prepare('SELECT count(*) AS n FROM research_job WHERE search_id=? AND kind='fetch_material'`
- **R** `tests/research-core.test.ts:329` — dois escritórios compartilham um download; parar um interesse não cancela o outro
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (8 assertions in inventory): `assert.equal(first.pages[0].results[0]?.id,judgmentId); / assert.equal(second.pages[0].results[0]?.id,judgmentId);`
- **R** `tests/research-core.test.ts:362` — revogar documentos durante transporte impede publicação e retira inteiro teor do FTS
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (7 assertions in inventory): `assert.equal((await searchResearchCorpus(person,{theme:'termoexclusivofulltext'})).results.some((item)=>item.id===id),true); / assert.equal((await searchResearchCorpus(person,{theme:'termoexclusivofulltext'})).results.some((item)=>item.id===id),false);`
- **R** `tests/research-core.test.ts:390` — Retry-After não é encurtado e quota adia job sem gastar tentativas
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (7 assertions in inventory): `assert.equal((await processNextResearchExternalJob({transport}))?.status,'queued'); / assert.equal(job.attempts,1);`
- **R** `tests/research-core.test.ts:410` — falha entre armazenamento e banco deixa órfão removível sem tocar versões válidas
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `try { await assert.rejects(stageResearchPdf(installation,id,bytes,'https://jurisdf.tjdft.jus.br/official.pdf'),/injected_failure/); } / assert.deepEqual(await getResearchOriginal(key),bytes);`
- **R** `tests/research-core.test.ts:424` — lease vencido não pode ser renovado nem concluído pelo antigo dono
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.ok(claimed); / assert.equal(await renewResearchLease(claimed,'antigo'),false);`
- **R** `tests/research-core.test.ts:442` — limpeza conserva original STJ enquanto checkpoint de ingestão o utiliza
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (7 assertions in inventory): `assert.match((await getResearchOriginal(key)).toString('utf8'),/sentinela/); / assert.match((await getResearchOriginal(originalKey)).toString('binary'),/^PK/);`
- **R** `tests/research-core.test.ts:465` — a página aplica rerank somente aos 20 exibidos e preserva os demais no acervo
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(baseline.results.length,25); / assert.equal(search.pages[0].results.length,20);`
- **R** `tests/research-core.test.ts:501` — consulta externa sem fonte temática apta mantém acervo local e sinaliza cobertura parcial
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(search.pages[0].status,'partial'); / assert.equal(search.pages[0].sourceError,'no_source_enabled');`
- **R** `tests/research-core.test.ts:514` — replay reconstitui job de material após queda entre resultado e fila
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal((await processNextResearchExternalJob({transport:fixture}))?.status,'completed'); / assert.equal((await testDb.prepare('SELECT count(*) AS n FROM research_search_result WHERE search_id=? AND judgment_id=?')`
- **R** `tests/research-core.test.ts:537` — espelho STJ fica pesquisável sem agendar download individual impossível
  - Real PostgreSQL research service/job/catalog/storage boundary: provenance, visibility, chunk versions, cursor scope, corruption, recovery and authorization. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (6 assertions in inventory): `assert.equal(search.pages[0].results[0]?.id,judgmentId); / assert.equal(search.pages[0].results[0]?.fullTextStatus,'unavailable');`

## tests/research-stj.test.ts

Real archive/metadata/catalog ingestion pipeline; identity/link authorization, licensing, replay/version ordering and checkpoint recovery.

- **R** `tests/research-stj.test.ts:55` — parser separa ID do espelho, SeqDocumento e só aceita recursos CKAN com licença esperada
  - Real archive/metadata/catalog ingestion pipeline; identity/link authorization, licensing, replay/version ordering and checkpoint recovery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (7 assertions in inventory): `assert.equal('judgment' in parsed && parsed.judgment.sourceJudgmentId,'000782366'); / assert.equal('documentId' in parsed && parsed.documentId,'4567');`
- **R** `tests/research-stj.test.ts:71` — descoberta e ingestão de espelho são idempotentes e um recurso antigo não sobrescreve o novo
  - Real archive/metadata/catalog ingestion pipeline; identity/link authorization, licensing, replay/version ordering and checkpoint recovery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (8 assertions in inventory): `assert.deepEqual(found.map(item => item.id),[older.id,newer.id]); / assert.equal((await runStj(transport)).status,'completed');`
- **R** `tests/research-stj.test.ts:106` — ZIP de íntegras só publica após vínculo explícito, inclusive ao reprocessar SHA igual
  - Real archive/metadata/catalog ingestion pipeline; identity/link authorization, licensing, replay/version ordering and checkpoint recovery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (8 assertions in inventory): `assert.equal((await runStj(transport)).status,'completed'); / assert.equal((await testDb.prepare("SELECT count(*) AS n FROM research_material_version v JOIN research_material m ON m.id=v.material_id WHERE m.judgment_id=? AND m.kind='full_text'")`
- **R** `tests/research-stj.test.ts:154` — checkpoint retoma lote de espelhos após adiamento sem duplicar versões
  - Real archive/metadata/catalog ingestion pipeline; identity/link authorization, licensing, replay/version ordering and checkpoint recovery. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal((await runStj(transport)).status,'queued'); / assert.equal(JSON.parse(String(resourceRow.checkpoint)).nextIndex,250);`

## tests/typesafe.test.ts

Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions.

- **R** `tests/typesafe.test.ts:49` — typesafe: an existing office key is adopted once as the platform connection
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (9 assertions in inventory): `assert.equal(adopted.hasKey, true); assert.equal(adopted.keyHint, 'lega-key'); assert.equal(adopted.rag, 'enabled'); assert.equal(adopted.feedback, 'enabled'); / assert.equal(decryptCredential(row.encrypted_api_key, parseCredentialKeyring()), 'legacy-office-key');`
- **R** `tests/typesafe.test.ts:67` — typesafe: encrypted platform settings, platform authorization, defaults and stale versions
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal((await connectionView()).hasKey, false); / assert.ok(!JSON.stringify(config).includes('fake-${a.officeId}'));`
- **R** `tests/typesafe.test.ts:78` — typesafe: one platform credential serves every office and provider failures never escape
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (7 assertions in inventory): `const result = await evaluate(context, 'rag', request, { send: async (key, req) => { assert.equal(key, 'fake-${a.officeId}'); return response(req); } }); / assert.equal(result.status, 'evaluated');`
- **R** `tests/typesafe.test.ts:92` — typesafe: concurrent reservations bound spend and timeout remains charged
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal((await evaluate(context, 'rag', request, { send })).status, 'budget_exceeded'); / release(); assert.equal((await first).status, 'evaluated');`
- **R** `tests/typesafe.test.ts:109` — typesafe: mudança de configuração durante reserva distingue desativação de indisponibilidade
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(providerCalled, false); / assert.equal(disabled.status, 'disabled');`
- **R** `tests/typesafe.test.ts:138` — typesafe: invalid answers, context limit, changed configuration and circuit breaker
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal((await evaluate(context, 'rag', { ...request, state: 'x'.repeat(30000) }, { send })).status, 'budget_exceeded'); / assert.equal(changed.status, 'unavailable');`
- **R** `tests/typesafe.test.ts:148` — typesafe: rerank shadow preserves RRF and enabled preserves source identities
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.deepEqual((await rerank(context, 'consulta', sources, { send })).sources, sources); / assert.deepEqual((await rerank(context, 'consulta', sources, { send })).sources.map(s => s.sourceId), ['b', 'a']);`
- **R** `tests/typesafe.test.ts:157` — typesafe: two rerank batches can share an office with concurrency one
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(ranked.status, 'evaluated', JSON.stringify({ status: ranked.status, reason: ranked.reason, calls })); / assert.equal(calls, 2); assert.equal(maximum, 1); assert.equal(ranked.applied, true);`
- **C** `tests/typesafe.test.ts:175` — agenda dates: rejected DST times have an actionable Portuguese error
  - Actually detects DST gap/fold rejection and Portuguese actionable error. Non-test caller: agenda interpret/apply -> localInstant. Keeper: agenda dates: civil date, year omission, midnight, invalid and duplicated local times already invokes EXACT same two dates/times/timezone. Add /horário.*Escolha outro horário/ to both existing assert.throws. History: actionable error added 279fe82; existing underlying Temporal API disambiguation reject type verified in polyfill/index.d.ts. Remove duplicate invocations only; no production seam. Risk low; typesafe suite.
  - Assertion evidence (1 assertions in inventory): `assert.throws(() => localInstant(day, time, 'America/New_York'), /horário.*Escolha outro horário/);`
- **R** `tests/typesafe.test.ts:181` — typesafe: cancelling a multi-batch rerank preserves the baseline and skips remaining calls
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(calls, 1); assert.equal(result.applied, false); assert.deepEqual(result.sources, sources);`
- **R** `tests/typesafe.test.ts:190` — agenda interpretation: no mutation, no invented meeting end, owner-scoped suggestions
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(result.proposal.payload.kind, 'meeting'); / assert.equal(result.proposal.payload.endsAt, null);`
- **R** `tests/typesafe.test.ts:199` — agenda autonomy: the Lume saves activities itself, WebMCP only suggests
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (7 assertions in inventory): `assert.ok(catalog.includes('k5_agenda_interpret')); assert.ok(!catalog.includes('k5_agenda_create_activity')); assert.ok(!catalog.includes('k5_agenda_apply_proposal')); / assert.ok(tools.k5_agenda_create_activity && tools.k5_agenda_update_activity);`
- **R** `tests/typesafe.test.ts:211` — agenda confirmation: concurrent retries and changed payload, receipt survives missing idempotency cache
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.deepEqual(a, b); / assert.equal((await testDb.prepare('SELECT count(*) AS n FROM agenda_activity WHERE office_id=?').get(context.officeId))!.n, 1);`
- **R** `tests/typesafe.test.ts:222` — agenda confirmation: receipt and activity roll back together on persistence failure
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (2 assertions in inventory): `await assert.rejects(runCapability(context, 'k5_agenda_apply_proposal', { proposalId: proposal.id, version: 1, payload: { kind: 'task', title: 'Revisar minuta' } })); / assert.equal((await testDb.prepare('SELECT count(*) AS n FROM agenda_activity WHERE office_id=?').get(context.officeId))!.n, 0);`
- **R** `tests/typesafe.test.ts:230` — agenda dates: civil date, year omission, midnight, invalid and duplicated local times
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (6 assertions in inventory): `assert.deepEqual(temporalCandidates('amanhã às 9h', '2026-09-22T01:00:00Z', 'America/Sao_Paulo').dates, ['2026-09-22']); / assert.ok(temporalCandidates('dia 30/02/2026', '2026-09-21T12:00:00Z', 'America/Sao_Paulo').questions.length);`
- **R** `tests/typesafe.test.ts:247` — document verification: semantic contradiction, incomplete coverage, no automatic approval and version invalidation
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(report.status, 'completed'); assert.equal(report.items[0].outcome, 'contradicted'); assert.equal(report.items[1].outcome, 'quote_not_found'); / assert.notEqual((await testDb.prepare('SELECT status FROM ai_artifact WHERE id=?').get(data.artifact.id))!.status, 'approved');`
- **R** `tests/typesafe.test.ts:257` — document verification: source removal and owner isolation; disabled configuration makes no calls
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(called, false); / assert.equal((await getVerification(context, { artifactId: data.artifact.id })).verification!.status, 'stale');`
- **R** `tests/typesafe.test.ts:266` — document verification: concurrent enqueue, checkpoints and lost lease never publish stale results
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (7 assertions in inventory): `assert.equal(new Set(ids).size, 1); / assert.equal((await testDb.prepare("SELECT count(*) AS n FROM artifact_verification WHERE artifact_id=? AND status IN ('queued','running')").get(data.artifact.id))!.n, 1);`
- **R** `tests/typesafe.test.ts:287` — document verification: revocation during a provider call discards the judgment
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (2 assertions in inventory): `assert.equal(report.status, 'stale'); assert.equal(report.results, '[]');`
- **R** `tests/typesafe.test.ts:298` — agenda confirmation: changed target version and foreign-office links require correction
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `await assert.rejects(runCapability(context, 'k5_agenda_apply_proposal', { proposalId: proposal.id, version: 1, activityId: activity.id, activityVersion: activity.version, payload: { kind: 'task', title: activity.title, status: 'completed' } }), { code: 'CONFLICT' }); / assert.equal((await testDb.prepare('SELECT status FROM agenda_activity WHERE id=?').get(ac`
- **R** `tests/typesafe.test.ts:309` — typesafe: an incomplete reranking batch leaves the entire baseline unchanged
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(calls, 2); assert.equal(ranked.applied, false); assert.deepEqual(ranked.sources, sources);`
- **R** `tests/typesafe.test.ts:319` — worker scheduling: a blocked verification does not delay pending deletion or subsequent work
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (6 assertions in inventory): `assert.ok(deletion.completed_at, 'Deletion remained pending behind the provider request'); / assert.ok(passes > 1, 'Subsequent worker passes remained blocked');`
- **D** `tests/typesafe.test.ts:356` — typesafe: key rotation includes decision connections in the atomic batch
  - Actually detects old reencryptAiConnectionSecrets touching platform TypeSafe key; it does not exercise live credentials route. Non-test callers of old helper: none. Keeper: credential-rotation / rotation covers every encrypted column atomically, preserves empty references and is idempotent; unreadable final table rollback case. Both seed typesafe_connection and typesafe_platform_connection. History: superseded by credential-rotation implementation. Coordinate old function removal with identity lane, retain live countSecretsNeedingReencryption. Risk low after all-column keeper; credential-rotation+platform+typesafe suites.
  - Assertion evidence (2 assertions in inventory): `assert.ok(result.reencrypted > 0); / assert.equal(decryptCredential(String(row.encrypted_api_key), next), 'fake-${context.officeId}');`
- **R** `tests/typesafe.test.ts:365` — typesafe: simultaneous reservations respect platform concurrency
  - Real shared platform config/reservation/verification/agenda boundary; preserve budget, concurrency, cancellation, revocation and proof ownership distinctions. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(maximum, 1); / assert.ok(calls >= 1 && calls < 6);`

## tests/vectorize-contract.test.ts

Container transport to contract fake plus real PostgreSQL indexing: deployment regression LUME-P, byte limits, generation identity, namespace isolation, safe errors, deletion. Do not replace transport with permissive stub.

- **R** `tests/vectorize-contract.test.ts:162` — vectorize (LUME-P): a document indexed through the Container proxy is published and answers queries
  - Container transport to contract fake plus real PostgreSQL indexing: deployment regression LUME-P, byte limits, generation identity, namespace isolation, safe errors, deletion. Do not replace transport with permissive stub. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (11 assertions in inventory): `assert.ok(queued, "an office with an embedding connection queues the job"); / assert.equal(status, "completed", 'the upsert is accepted by the index contract (job error: ${failure?.error})');`
- **R** `tests/vectorize-contract.test.ts:197` — vectorize: another office never reads these vectors, even naming the same generation and document
  - Container transport to contract fake plus real PostgreSQL indexing: deployment regression LUME-P, byte limits, generation identity, namespace isolation, safe errors, deletion. Do not replace transport with permissive stub. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(await runJob(queued.jobId), "completed"); / assert.equal((await index.query(a.officeId, queued.generationId, query, { documentIds: [doc.documentId], topK: 10 })).length, 1);`
- **R** `tests/vectorize-contract.test.ts:212` — vectorize: a job failed the way staging failed recovers by re-queueing, with an honest progress count
  - Container transport to contract fake plus real PostgreSQL indexing: deployment regression LUME-P, byte limits, generation identity, namespace isolation, safe errors, deletion. Do not replace transport with permissive stub. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(again.jobId, first.jobId, "the same job is re-queued, not duplicated"); / assert.deepEqual({ ...reset, attempts: Number(reset?.attempts), cursor: Number(reset?.cursor), done: Number(reset?.done) },`
- **R** `tests/vectorize-contract.test.ts:239` — vectorize: a rejected binding call reaches the Container as a safe error code, not `fetch failed`
  - Container transport to contract fake plus real PostgreSQL indexing: deployment regression LUME-P, byte limits, generation identity, namespace isolation, safe errors, deletion. Do not replace transport with permissive stub. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (6 assertions in inventory): `assert.equal(upsert.status, 502); / assert.deepEqual(JSON.parse(upsertBody), { code: "vectorize_40008" });`
- **R** `tests/vectorize-contract.test.ts:272` — vectorize: a rejected upsert is reported with its stage and code, never the provider text
  - Container transport to contract fake plus real PostgreSQL indexing: deployment regression LUME-P, byte limits, generation identity, namespace isolation, safe errors, deletion. Do not replace transport with permissive stub. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.equal(captured.length, 1); / assert.deepEqual(captured[0].tags, { "knowledge.stage": "vector_upsert", "knowledge.error_code": "vectorize_40008", operation: "knowledge.index" });`
- **R** `tests/vectorize-contract.test.ts:299` — vectorize ids: within 64 bytes, reversible, and refused rather than truncated for unknown shapes
  - Container transport to contract fake plus real PostgreSQL indexing: deployment regression LUME-P, byte limits, generation identity, namespace isolation, safe errors, deletion. Do not replace transport with permissive stub. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (6 assertions in inventory): `assert.ok(Buffer.byteLength(id) <= 64, '${Buffer.byteLength(id)} bytes'); / assert.deepEqual(parseVectorizeId(id), { generationId, chunkId });`
- **R** `tests/vectorize-contract.test.ts:314` — vectorize: deleting a document removes exactly its vectors from the index
  - Container transport to contract fake plus real PostgreSQL indexing: deployment regression LUME-P, byte limits, generation identity, namespace isolation, safe errors, deletion. Do not replace transport with permissive stub. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(await runJob(queued.jobId), "completed"); / assert.equal(fake.vectors.size, 3);`

## tests/web-jurisprudence.test.ts

Grounding and scored/fallback result behavior under independent candidate/link fixtures; malformed and unsafe URLs remain unique negative cases.

- **R** `tests/web-jurisprudence.test.ts:41` — web jurisprudence: malformed output is dropped and only links the search returned survive
  - Grounding and scored/fallback result behavior under independent candidate/link fixtures; malformed and unsafe URLs remain unique negative cases. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.deepEqual(parseCandidates('sem json'), []); / assert.equal(parseCandidates(modelText).length, 4);`
- **R** `tests/web-jurisprudence.test.ts:50` — web jurisprudence: Jev keeps related court decisions, ordered by relevance
  - Grounding and scored/fallback result behavior under independent candidate/link fixtures; malformed and unsafe URLs remain unique negative cases. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (4 assertions in inventory): `assert.equal(result.evaluated, true); / assert.deepEqual(result.results.map(item => [item.court, item.relevanceLabel]), [['STJ', 'Muito relevante'], ['STF', 'Relevante']]);`
- **R** `tests/web-jurisprudence.test.ts:61` — web jurisprudence: without Jev the grounded list still comes back, marked as not evaluated
  - Grounding and scored/fallback result behavior under independent candidate/link fixtures; malformed and unsafe URLs remain unique negative cases. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (5 assertions in inventory): `assert.deepEqual(result.results, []); / assert.match(result.note, /Nenhum julgado com link verificável/);`
- **C** `tests/web-jurisprudence.test.ts:73` — web jurisprudence: only the Lume gets the tool
  - Actually detects reviewer agent published and lawyer webmcp unpublished flag. Non-test callers: agentTools and browser tool publication. Keeper: research-capabilities / somente leituras de acervo, julgado e referências são publicadas already asserts exact lawyer agent/webmcp sets plus instantiated agent tool map. Carry reviewer agent includes k5_research_web_jurisprudence into keeper. History: both from 34326cc web jurisprudence addition. Remove publishedCapabilitiesForRole import from web-jurisprudence suite. Risk low; both research-capabilities/web-jurisprudence suites.
  - Assertion evidence (2 assertions in inventory): `assert.ok(publishedCapabilitiesForRole('reviewer', 'agent').includes('k5_research_web_jurisprudence')); / assert.ok(!publishedCapabilitiesForRole('lawyer', 'webmcp').includes('k5_research_web_jurisprudence'));`

## tests/worker-scheduler.test.ts

Observable scheduling lifecycle --once/error draining remains distinct from normal stop.

- **R** `tests/worker-scheduler.test.ts:5` — worker --once drains both queues even if one fails, without starting another verification
  - Observable scheduling lifecycle --once/error draining remains distinct from normal stop. Detects violation of the concrete outcomes/assertions below, rather than only invocation. No stronger duplicate with identical risk established; preserve.
  - Assertion evidence (3 assertions in inventory): `assert.equal(finished, false); / assert.equal(calls, 1); assert.deepEqual(errors, [failure]);`
- **D** `tests/worker-scheduler.test.ts:25` — worker shutdown drains the active verification and does not claim its requeued batch
  - Actually detects scheduler stops after verifyDocuments flips stopping and returns true. Non-test caller: scripts/worker.ts. Stronger keeper: typesafe / worker scheduling: a blocked verification does not delay pending deletion or subsequent work invokes real processNextVerification with nine units, stops while first provider batch blocked, releases/drains and asserts checked=4,total=9,status=queued. History: both from 2731ea6 concurrency fix. Remove only duplicate mock-only shutdown declaration; retain --once/error test (distinct). No seam removed; worker-scheduler+typesafe suites.
  - Assertion evidence (1 assertions in inventory): `assert.equal(calls, 1);`

## Second independent layer pass

This pass treats the ledger as input and rejects superficial compression: no wrapping unrelated tests, no deleting security/config/transport tests to reach a quota. {"R":166,"F":3,"C":5,"D":6}; 11 retirement candidates.

- Judicial normalization: retire 4 dead-helper cases and remove toCaseIdentity, cnjRoutingHint, movementFingerprint. Keep all actual CNJ checksum/date/parser/publication contracts. Remove test-only sourceDay helper and its two assertions inside retained impossible-date case. Remove test-only isWorkerSafe and replace its two uses with direct expected effect assertions in retained DJEN capability metadata test. The latter is an external metadata contract and stays. Keep permits (live collector/service callers).
- DJEN parser/connector redundant layer: retire 2 normalize fixture cases after carrying 7 distinct field assertions into listChanges coverage keeper. Keep changed-schema, markup, error codes, unsupported window, no-broad-sweep and SSRF tests.
- TypeSafe temporal duplicate: retire standalone DST case after strengthening same two rejection checks in existing date test. Retire obsolete credential-rotation case after identity lane removes dead reencryptAiConnectionSecrets. Keep actual two-phase rotation and all-column rollback suite.
- Worker scheduling: retire mock-only shutdown case, keep actual verification/checkpoint+deletion draining scenario and --once failure lifecycle case.
- PWA cache: retire basic reuse case only after same-version cache-hit assertions are incorporated into existing release-transition fixture. Cross-version and same-version are different code paths; do not remove without the carry. All remaining PWA privacy/push/offline/update tests and browser harnesses remain.
- Research publication: retire web-jurisprudence flag-only test after reviewer publication assertion moves into canonical research-capabilities owner. No material/source/assessment runtime deletion.
- No entire test files retired. Total defensible executed-case reduction proposed: 11 (6 D, 5 C). F indexing race needs genuine worker proof, not merely deleting fake SQL. F historical-alert empty-list negative and conditional cursor branch are independent preservation follow-ups; the first can be repaired by a count assertion.

## QA/support retained inventory

R: scripts/verify-staging.ts (R2/Vectorize/PostgreSQL live deployment); scripts/verify-pwa.ts (installability, private cache, theme and offline); scripts/verify-pwa-update.ts (two-version browser release); scripts/verify-research-ui.ts (research user flow); scripts/verify-research-draft.ts (selected material through draft); scripts/research-assessment-eval.ts + tests/fixtures/research-assessment-corpus.ts (quality evaluation, independent corpus); scripts/typesafe-eval.ts + scripts/typesafe-eval-store.ts (paid model evaluation and outcomes); scripts/seed-research-qa.ts (shared QA setup); scripts/verify-sentry.ts, verify-sentry-cloudflare.ts, verify-sentry-browser.ts (live telemetry and source-map delivery); scripts/verify-workspace-ui.ts (cross-lane UI). Kept as manual QA, not included in Node declaration denominator. No harness retired/unlocked.

Shared test setup/postgres fixtures, judicial fixture transport, vector/storage reset hooks remain required by retained owners. Do not remove based solely on test-like names.

Validation proposed (root owns serialization): relevant files through pnpm --filter @k5/web exec tsx scripts/test-postgres.ts with supported selection; then pnpm lint/typecheck/test; diff --check; coverage compare fixed source denominator. Mutation proof required if repairing the index lease assertion: remove runtime WHERE lease_owner equality, confirm real worker test fails, restore source byte-for-byte. No validation result claimed by this read-only lane.
