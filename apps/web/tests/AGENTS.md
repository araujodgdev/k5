# Test ownership

- Credential rotation belongs to `credential-rotation.test.ts`, through the transactional
  rotation owner and authenticated route. Keep compatibility checks for legacy ciphertext
  and the setup count helper; production code with no runtime caller can be retired with its tests.
- Google write retries belong to the Gmail, Drive and Calendar transport suites. Keep
  distinct replay paths: Gmail's early replay does not prove the shared operation executor.
- Document transformations belong to the composed chronology or exported DOCX. Move unique
  assertions there before removing tests of intermediate structures or private helpers.
- Judicial parsing belongs to connector results and persisted collection outcomes. Keep
  protocol, checksum, date, source-policy and replay guarantees independently testable.
- Race tests must pause the production operation, change its live lease or state, then resume it.
  Assertions against SQL written only by the test do not exercise the worker's lease guard.
- Before retiring a case, name its remaining keeper and transfer any unique assertion.
  Validate the transfer with a deliberate production mutation when its protection is uncertain.
