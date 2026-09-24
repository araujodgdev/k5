import "./test-setup";
import assert from "node:assert/strict";
import test from "node:test";

import {
  cnjCheckDigits, formatCnjNumber, isValidCnjNumber, parseCnjNumber,
} from "../src/lib/judicial/normalization/cnj";
import { overlappingWindow, parseSourceDate, windowDays } from "../src/lib/judicial/normalization/dates";
import { alertDedupeKey, publicationFingerprint } from "../src/lib/judicial/normalization/fingerprint";
import type { NormalizedPublication } from "../src/lib/judicial/contracts";

const VALID = "00000010520258260100";

test("CNJ: accepts a well-formed number in every punctuation the sources use", () => {
  for (const value of [VALID, "0000001-05.2025.8.26.0100", " 0000001-05.2025.8.26.0100 "]) {
    const parsed = parseCnjNumber(value);
    assert.equal(parsed.ok, true, `deveria aceitar ${value}`);
    if (!parsed.ok) return;
    assert.equal(parsed.normalized, VALID, "a forma normalizada é sempre os vinte dígitos");
  }
  assert.equal(formatCnjNumber(VALID), "0000001-05.2025.8.26.0100");
});

test("CNJ: the parts decompose as Resolução 65/2008 describes", () => {
  const parsed = parseCnjNumber(VALID);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.parts, {
    sequential: "0000001", checkDigits: "05", year: "2025", segment: "8", court: "26", unit: "0100",
  });
  // The check digits are derived, not stored: recomputing them has to reproduce the original.
  assert.equal(cnjCheckDigits(parsed.parts), "05");
});

test("CNJ: a single altered digit fails the check, so it never joins on the CNJ index", () => {
  // Same shape, same length, one digit changed in the sequential part.
  const tampered = `0000002${VALID.slice(7)}`;
  const parsed = parseCnjNumber(tampered);
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.reason, "check_digits");
  assert.equal(isValidCnjNumber(tampered), false);
});

test("CNJ: malformed inputs are rejected with the reason, never coerced", () => {
  assert.deepEqual(parseCnjNumber("123"), { ok: false, reason: "length" });
  assert.deepEqual(parseCnjNumber("0000001-05.2025.8.26.010"), { ok: false, reason: "length" });
  assert.deepEqual(parseCnjNumber("abcdefghijklmnopqrst"), { ok: false, reason: "characters" });
  assert.deepEqual(parseCnjNumber(""), { ok: false, reason: "characters" });
  // Twenty digits whose year is impossible is a transcription error, not a 1500s proceeding.
  assert.deepEqual(parseCnjNumber("00000010515008260100"), { ok: false, reason: "year" });
});

test("dates: a date with no time never acquires one", () => {
  const brazilian = parseSourceDate("12/03/2025");
  assert.deepEqual(brazilian, { value: "2025-03-12", precision: "date", timezone: null });

  const iso = parseSourceDate("2025-03-12");
  assert.deepEqual(iso, { value: "2025-03-12", precision: "date", timezone: null });

  // Inventing midnight UTC would place this on 11 March in Brasília and shift every deadline
  // computed from it by a day.
  assert.equal(brazilian?.value.includes("T"), false);
});

test("dates: precision and timezone are preserved exactly as the source wrote them", () => {
  assert.deepEqual(parseSourceDate("2026-09-10T14:32:00-03:00"), {
    value: "2026-09-10T14:32:00", precision: "second", timezone: "-03:00",
  });
  assert.deepEqual(parseSourceDate("2026-09-10T14:32Z"), {
    value: "2026-09-10T14:32", precision: "minute", timezone: "Z",
  });
  // A court publishing a local time without an offset leaves the zone genuinely unknown.
  assert.deepEqual(parseSourceDate("10/09/2026 14:32"), {
    value: "2026-09-10T14:32", precision: "minute", timezone: null,
  });
});

test("dates: an unparseable or impossible value is rejected rather than guessed", () => {
  assert.equal(parseSourceDate("31/02/2025"), null, "30 de fevereiro não existe");
  assert.equal(parseSourceDate("2025-13-01"), null);
  assert.equal(parseSourceDate("2025-03-12T25:00:00Z"), null);
  assert.equal(parseSourceDate("em breve"), null);
  assert.equal(parseSourceDate(null), null);
  assert.equal(parseSourceDate(""), null);

});

test("windows: the refresh window overlaps the watermark so a late publication is not skipped", () => {
  const window = overlappingWindow("2026-09-10", "2026-09-12T08:00:00Z", 2);
  assert.deepEqual(window, { from: "2026-09-08", to: "2026-09-12" });
  assert.equal(windowDays(window.from, window.to), 5, "a janela é inclusiva nas duas pontas");

  // Without a watermark there is nothing to overlap: a first run asks for today only, and
  // widening history is an explicit backfill.
  assert.deepEqual(overlappingWindow(null, "2026-09-12T08:00:00Z", 2), { from: "2026-09-12", to: "2026-09-12" });
});

function publication(overrides: Partial<NormalizedPublication> = {}): NormalizedPublication {
  return {
    sourcePublicationId: null, cnjNumber: VALID, edition: "3210", page: "114", officialHash: null,
    body: "Fica a parte intimada.", madeAvailableOn: "2026-09-10", publishedOn: "2026-09-11",
    sourceUpdatedAt: null, revisionKind: "original",
    ...overrides,
  };
}

test("fingerprints: an errata is a different row from the publication it corrects", () => {
  const original = publicationFingerprint(publication());
  const errata = publicationFingerprint(publication({ revisionKind: "errata" }));
  // Collapsing these would overwrite the record of what was originally published.
  assert.notEqual(original.value, errata.value);

  const byId = publicationFingerprint(publication({ sourcePublicationId: "djen-1" }));
  const byIdErrata = publicationFingerprint(publication({ sourcePublicationId: "djen-1", revisionKind: "errata" }));
  assert.notEqual(byId.value, byIdErrata.value, "a versão participa da identidade mesmo com id da fonte");
});

test("fingerprints: the official hash outranks derived fields when the court publishes one", () => {
  const hashed = publicationFingerprint(publication({ officialHash: "abc123" }));
  assert.equal(hashed.strategy, "source_id");
  // The body being re-rendered by the portal must not create a second row for the same entry.
  assert.equal(hashed.value, publicationFingerprint(publication({ officialHash: "abc123", body: "outro texto" })).value);
});

test("alerts: the dedupe key is stable for the same event and distinct across kinds", () => {
  assert.equal(alertDedupeKey("new_publication", "publication", "p1"), alertDedupeKey("new_publication", "publication", "p1"));
  assert.notEqual(alertDedupeKey("new_publication", "publication", "p1"), alertDedupeKey("historical_publication", "publication", "p1"));
  assert.notEqual(alertDedupeKey("new_publication", "publication", "p1"), alertDedupeKey("new_publication", "publication", "p2"));
});
