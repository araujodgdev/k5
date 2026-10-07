# Source-policy design rubric

The parent and independent cross-judge score each criterion 1-5. These are design judgments, not runtime measurements.

1. Usable normal workflow. A personalized person with existing private memory can create/edit/review a shared page in the persistent Lume conversation. Known private archival and direct person-authored publication still work. Any context restriction is specific and does not turn the feature into a blanket denial.
2. Complete, honest input and source boundary. Model-visible/replayed bytes cannot escape source admission through approvals, selection duplication, generated settings or derived memory. Unknown origins are neither magically recovered nor declared safe. Current protected-source permissions survive derived managed copies and audience changes.
3. Version and concurrency correctness. A/B/A, concurrent page edits, exact pending approvals, cancellation, stale CAS, retry, legacy graph data and source revocation have explicit finite and atomic behavior.
4. Interface depth and scope. One clear policy owner, small hard-to-bypass public surface, few caller-coordinated stages, no parallel allowlists or universal DLP rebuild. Deletes the invalid provenance shape and reuses accepted ownership/runtime.
5. Concrete implementation and proof. Additive migration and existing-data semantics, transaction/helper fit, realistic type/call-site sketches, caller migration list and meaningful admission/concurrency/browser tests enable one writer to implement and verify now.

Cross-judge reads every candidate in full, scores per criterion with short evidence, screens design red flags, chooses a base and possible grafts, names unresolved contract violations. It must not pick safety-by-total-feature-denial or convenience-by-dropping-source-restrictions. Account for provider quota fallbacks and staggered launch only as orchestration details, not candidate quality.

