# Lume observability assessment, 29 September 2026

Lume has broad exception reporting and useful diagnostic records. It can identify many failures without a user report. It has weaker coverage for stalled work, broken user journeys, and the process of assigning, fixing, deploying, and verifying a correction. Overall proactive readiness is approximately **5/10**.

This assessment combines the local working tree at `c5ef260`, read-only queries to Sentry project `lume-wr/lume`, live settings for the three Cloudflare Workers, public HTTP checks, and five focused tests. The local tree contained unrelated uncommitted changes, which were preserved. Live observations were collected around 14:30-15:00 UTC. They are a snapshot, not a continuous availability measurement.

Scores are engineering judgments. Readiness uses 0 for absent, 5 for partial coverage, and 10 for broad coverage verified through detection, notification, and response. Confidence expresses confidence in the assessment, not a measured probability of catching bugs. The overall score is the rounded, equally weighted average of these seven dimensions.

| Capability | Readiness | Confidence | Basis |
| --- | ---: | ---: | --- |
| Capturing runtime errors | 8/10 | 95% | Browser, Next.js, Cloudflare, Node processors, queues, and chat instrumentation; live events confirm ingestion. |
| Diagnosing captured errors | 6/10 | 90% | Stack traces, release IDs, source-map tooling, Cloudflare logs, and internal agent traces; generic error messages and mixed environments limit diagnosis. |
| Alerting a responsible person | 4/10 | 95% | Enabled high-priority email rule with recent trigger; no explicit owner, escalation, or delivery acknowledgment verified. |
| Detecting silent stalls and downtime | 2/10 | 95% | Uptime checks target the former staging address; no Sentry cron or metric monitors; retries exist but do not independently detect missing execution. |
| Detecting broken user journeys | 3/10 | 90% | Browser tests exist, but the checked CI has no browser-test step or schedule, and no scheduled journey monitoring was found. |
| Preventing regressions before release | 7/10 | 90% | CI defines lint, typecheck, PostgreSQL tests, migrations, and Next.js build. The deployed vinext build is not exercised by that workflow. Branch protection and latest CI success were not verified. |
| Closing the incident through a verified fix | 3/10 | 80% | Historical manual investigation and fixes exist; job retries recover some transient failures. No complete automated issue-to-deploy-to-verification process was verified. |

The existing tools complement one another as follows.

| Tool or mechanism | What exists today | Limitation |
| --- | --- | --- |
| Sentry | Exception reporting across runtimes, sampled tracing, AI spans, releases, source-map upload tooling, high-priority email alert, one uptime monitor. | Its uptime target is stale. No cron/metric monitors were returned for this project. Logs and custom metrics are disabled in application SDK settings. |
| Cloudflare Workers Observability | Live settings confirm persistent invocation/application logs and traces for `lume`, `lume-notifications`, and `lume-integrations`, all with head sampling set to 1. | Account notification policies returned only two billing alerts. Worker Logpush is disabled, no tail consumers are configured, and account-level Logpush jobs are empty. Zone-level export configurations were not inspected. |
| GitHub Actions and automated tests | PR/main workflow runs lint, typecheck, tests, database setup, and build; a separate PR job rejects changes to applied migrations. | This prevents some defects before release. It does not continuously test the deployed service. No vinext build or Playwright step in this workflow. |
| Playwright and Sentry verification scripts | Desktop/mobile chat test config, document-save test config, browser telemetry verification, Node and Cloudflare ingestion probes. | Present as runnable tools; not found scheduled in repository CI. Historical successful execution is not evidence they run continuously. |
| Internal PostgreSQL agent traces | Model steps, tool calls/results, durations, outcomes, and a Sentry trace link. A cleanup function implements 30-day retention. | Useful for investigation. Live trace completeness, cleanup operation, and automatic failure thresholds were not checked. |
| TypeSafe | Selected AI evaluations, persisted evaluation outcomes, budgets, circuit breaking, and an opt-in evaluation script. | This checks aspects of AI output quality, not application availability. Live enablement was not verified. Credential errors can disable the evaluator without a Sentry capture in that catch path. |
| Durable jobs and recovery | Leases, retries/backoff, stored failure codes, and terminal states in several job systems. | Recovery works only while execution continues. A stopped scheduler can leave work pending without producing an exception. |

No integration with Datadog, Grafana/Prometheus, Better Stack, Checkly, or PostHog was found in the inspected application configuration and dependencies. That does not rule out a service configured independently outside this repository and the connected accounts.

The strongest current findings are below, ordered by what should be addressed first.

1. **The uptime monitor checks the former address. Confidence 99%.** [Monitor 10418082](https://lume-wr.sentry.io/monitors/10418082/) checks `https://k5-staging.k5-web.workers.dev` every 60 seconds. It is enabled, marked failed, and its recent checks returned HTTP 404. The configured threshold is three failed checks. Independent requests returned 404 for that address and 200 for `https://lume.software`. Both HTTP and HTTPS sign-in requests returned 200 during this audit. These checks do not prove authenticated login or database operations work. No uptime monitor for the current domain was returned.

2. **The deployed service is labeled staging in Sentry. Confidence 99%.** Live settings on all three Workers have `SENTRY_ENVIRONMENT=staging`. The browser vinext build also defaults production-mode builds to staging unless overridden. A current-domain sign-in event carries that same label. A dashboard filtered to `environment:production` will therefore miss these events. See [Worker configuration](../apps/web/wrangler.jsonc) and [browser build configuration](../apps/web/vite.config.ts).

3. **No independent monitoring of missed background execution was found. Confidence 95%.** Sentry returned zero cron monitors and zero metric monitors. Application cron handlers capture exceptions, but no Sentry check-in calls were found in the reviewed Worker/scripts paths. Container activity heartbeats keep a process awake; they are not external failure monitors. The processor `/health` handler simply returns `ok`; it does not test database access or job progress. See [processor server](../apps/web/scripts/processor-server.ts), [scheduler](../apps/web/src/workers/web.ts), and [queue inspection](../apps/web/src/lib/processor-schedule.ts).

4. **Notification is configured, but response ownership is weak. Confidence 95% for configuration; receipt unverified.** [Alert 6046507](https://lume-wr.sentry.io/monitors/alerts/6046507/) triggers for new/existing high-priority issues. It emails issue owners with fallback to active members. Its owner and environment are unset, and its last trigger was 29 September at 13:13:31 UTC. No Slack/PagerDuty action or acknowledgment/escalation chain was returned. A trigger timestamp is not proof someone received or acted on an email.

5. **Some failures are handled without an incident signal. Confidence 95% for the inspected paths.** [The capability HTTP client](../apps/web/src/lib/capabilities/http-client.ts) converts a fetch exception into a `NETWORK` result without reporting it. [Agenda forms](../apps/web/src/components/agenda-forms.tsx) display an error after catching it. Server exceptions can still be reported independently, but failures before reaching the server need not become Sentry issues. [TypeSafe's client](../apps/web/src/lib/typesafe/client.ts) records unavailable evaluations and can disable credentials without an explicit Sentry capture in that catch. Report unexpected failures with safe categories and rate limits; ordinary validation and cancellation should remain quiet.

6. **Privacy controls remove useful diagnostic distinctions. Confidence 95%.** [captureOperationalError](../apps/web/src/lib/observability/report.ts) preserves error class and stack but replaces the message and drops the original cause/properties. This protects client data, but can hide HTTP status, database SQLSTATE, timeout category, or retry exhaustion unless callers add safe tags. The recent `processors.dispatch` event has a generic message and no processor-role tag. Add an allowlisted diagnostic schema instead of restoring raw provider responses, prompts, or documents.

7. **Testing and production signals are mixed. Confidence 95%.** The last-24-hour error results include four `SEO verification` events under `staging`. Development/test defaults are disabled, but build/runtime overrides can still send test traffic into operational environments. Separate verification/preview traffic and align browser, Worker, and processor release labels.

8. **Cloudflare privacy settings differ from Sentry's. Confidence 99% for configuration, exposure unverified.** Sentry explicitly strips query parameters and other private fields. All three live Worker settings returned `redact_query_string=false`. Sentry scrubbing does not apply to Cloudflare's independently collected logs. Review this setting and structured logs before expanding retention or exports. This is a configuration observation, not proof sensitive data was logged.

Current errors show that ingestion works, but they do not measure the application's failure rate. At query time, the rolling seven-day Sentry error dataset had 200 events: 194 staging, five production, and one preview-refactor. A separate unresolved-issue search over seven days returned 26 groups, including test traffic and an uptime issue. Issue-group occurrence totals are not interchangeable with time-window event counts.

The rolling 24-hour error query returned 58 events:

| Issue | Events in 24h | Assessment |
| --- | ---: | --- |
| [LUME-H](https://lume-wr.sentry.io/issues/LUME-H), processor dispatch | 31 | Unresolved and marked regressed. Latest inspected event is generic; the underlying cause is not established by this audit. |
| [LUME-B](https://lume-wr.sentry.io/issues/LUME-B), session retrieval | 19 | Repeated session failures deserve investigation. No root cause established here. |
| [LUME-14](https://lume-wr.sentry.io/issues/LUME-14), SEO verification | 4 | Explicit verification traffic; exclude from a real-incident count. |
| [LUME-13](https://lume-wr.sentry.io/issues/LUME-13), authentication configuration | 2 | Event on `http://lume.software/sign-in` reports a missing/short authentication secret. Later public sign-in checks returned 200; persistence, cause, and authenticated behavior remain unverified. |
| [LUME-6](https://lume-wr.sentry.io/issues/LUME-6), lost network connection | 2 | Network failure signal; insufficient evidence to attribute it to a specific internal or external component. |

[Open the unresolved-issue dashboard](https://lume-wr.sentry.io/issues/?project=4512130123169792&query=is%3Aunresolved&statsPeriod=7d). User counts of zero must not be read as zero people affected: application scrubbing removes user identity. This audit did not measure a request denominator, uptime percentage, mean detection time, or mean repair time.

The practical improvement sequence is:

| Order | Change | Proof required before considering it complete |
| --- | --- | --- |
| 1 | Monitor the current domain, align production/preview/verification environments, and assign an alert owner. | An approved controlled failure reaches the intended recipient; recovery also appears; test traffic stays separate. |
| 2 | Register cron check-ins for scheduled dispatch, notification, and integration execution. Add thresholds for oldest pending work, terminal failures, and time since successful processing. | Simulate a missed execution and a stuck synthetic job in an isolated environment. Confirm both raise alerts even without a thrown exception. |
| 3 | Add scheduled browser checks with a dedicated synthetic office: sign in, read/write an agenda item, upload a tiny fixture and wait for ready, and verify a low-cost chat turn. | Run independently of deployments; failed assertions alert an owner and retain a trace. Clean up synthetic data. |
| 4 | Add safe structured diagnostic fields and a dashboard for error rate, latency, job age, processing success, and AI completion/failure. | Operators can distinguish credential, timeout, provider, database, and exhausted-retry failures without private content. Thresholds use a traffic/work denominator. |
| 5 | Add vinext/Cloudflare compilation and the critical browser suite to CI, then verify each deployment with the same checks. | A deliberately broken runtime configuration or critical journey fails the release checks. |
| 6 | Establish incident ownership, regression tests, release verification, and recurrence review. | One controlled incident is detected, assigned, reproduced, fixed, reviewed, deployed, and verified through the whole process. |

Keep Sentry and Cloudflare as the core. The most useful additional software would be a service that runs real browser journeys continuously. [Checkly supports scheduled Playwright monitoring](https://www.checklyhq.com/product/start-monitoring-with-playwright/), which fits the tests already in this repository. A scheduled CI runner is another implementation option, with its own scheduling, browser artifacts, and alerting work. The reason to add it is to detect a login or upload flow failing while the homepage still returns 200.

Longer log retention is a separate decision. [Cloudflare documents Workers log retention of three days on Free and seven days on Paid](https://developers.cloudflare.com/workers/observability/logs/workers-logs/). No account plan or effective historical retention was verified here. If investigations regularly exceed that window, evaluate an export destination after agreeing on safe fields and retention. Buying another dashboard will not by itself close the notification and response gaps.

Sentry also has an enabled [Seer PR-ready email workflow](https://lume-wr.sentry.io/monitors/alerts/6046218/), but `lastTriggered` was null. That is evidence of notification configuration only. It does not prove automatic analysis, PR creation, deployment, or successful repair. Selected inspected issues also had low actionability. Human-reviewed fixes and verified recovery remain necessary; job retries are the recovery automation that is clearly implemented today.

Validation performed: read-only repository/account inspection, public HTTP checks, and `pnpm --filter @k5/web test tests/observability.test.ts tests/vault-observability.test.ts`, which passed all five tests. These cover telemetry defaults, scrubbing, worker argument handling against PostgreSQL, and Vault reporting behavior. They do not prove live email delivery or full runtime coverage. No new synthetic incident, live alert change, production mutation, full application test run, lint, typecheck, or build was performed. Only this report was added.
