# Observability implementation

Target: at least 7/10 readiness with evidence-based confidence above 80% in alert ownership, diagnosis, downtime/stall detection, workflow monitoring, and incident closure. Keep the existing pre-deployment CI workflow unchanged as requested. Do not upgrade scores from configuration alone.

Verification predicates:

- The current public domain is monitored and successful checks appear in Sentry.
- Production alerts have an explicit responsible recipient and a tested notification path.
- Missing scheduled execution and stale queues produce independent failure signals.
- Safe diagnostic codes survive reporting while private provider content does not.
- Scheduled browser monitoring verifies authenticated journeys in an isolated synthetic office and retains failure evidence.
- Incident records require reproduction, a regression check, release identity, and post-deployment recovery evidence.

Work sequence:

- [x] Read the project instructions and the principles referenced by the execution skill.
- [x] Capture the existing monitoring baseline in the assessment dated 29 September.
- [x] Correct uptime configuration and alert ownership. The user confirmed delivery of the controlled drill to info@lume.software; LUME-16 is resolved.
- [x] Implement and test safe diagnostic fields and production environment defaults.
- [x] Add cron monitoring and queue age checks with real database tests.
- [x] Add scheduled synthetic journeys, isolated credentials, failure artifacts, and alert reporting. Full remote execution passed; repeated scheduled recovery remains under observation.
- [x] Add an incident verification record and operational runbook.
- [x] Run required repository checks, deploy authorized changes, and verify live signals.
- [x] Audit the decision trail and publish measured readiness with remaining limits.

This is a multi-part operational change. Each unit gets a local check before integration; live configuration is re-read after mutation. The implementation uses Sentry plus a dedicated Cloudflare Worker, Browser Run, PostgreSQL leases, and private R2 evidence with seven-day retention. These services consume existing account quotas; no additional vendor was introduced.

Repository verification: 659 tests passed after the check-in transport correction. Root lint passed with one existing warning, root typecheck passed, database setup passed, and both the Next.js build and deployed vinext build completed. After the final browser selector edit, root lint/typecheck and a full remote journey passed again. The initial processor-container rollout exceeded Cloudflare's 4 GB image limit after the web Worker had already published. Moving browser-only Puppeteer was insufficient; inspecting the production dependency graph identified Wrangler/workerd entering through the Cloudflare SDK peer. Both Worker-only packages now remain development dependencies, bundled for deployment. A second deployment blocker came from the earlier Worker rename: the existing container application name is now explicit. Application version 39 reached 100% with the new image; the Worker deployed as `46a04e1e-dc4b-4409-8033-f36488ea2fa6`.
