/**
 * CNJ proceeding numbers (Resolução CNJ 65/2008): NNNNNNN-DD.AAAA.J.TR.OOOO, twenty digits.
 *
 * Section 6 of the plan: validate the digits and the shape, but never let this become the only
 * key of a proceeding. A legacy number that fails this check is still a real identity and is
 * preserved verbatim as `nativeNumber` rather than rejected.
 */

export type CnjParts = {
  /** Sequential number inside the unit and year. */
  sequential: string;
  checkDigits: string;
  year: string;
  /** Segment of justice: 4 = federal, 8 = state, 3 = superior courts, and so on. */
  segment: string;
  court: string;
  /** Originating unit — the forum or section, not the court. */
  unit: string;
};

export type CnjParseResult =
  | { ok: true; normalized: string; formatted: string; parts: CnjParts }
  | { ok: false; reason: 'length' | 'characters' | 'check_digits' | 'year' };

const DIGITS_ONLY = /^\d+$/;

/** Strips the punctuation the sources disagree about, leaving only digits. */
export function stripCnjPunctuation(value: string): string {
  return value.replace(/[^\d]/g, '');
}

/**
 * ISO 7064 MOD 97-10, computed digit by digit. A twenty-digit number exceeds Number.MAX_SAFE_INTEGER,
 * so the remainder is carried instead of the value.
 */
function mod97(digits: string): number {
  let remainder = 0;
  for (let index = 0; index < digits.length; index += 1) {
    remainder = (remainder * 10 + (digits.charCodeAt(index) - 48)) % 97;
  }
  return remainder;
}

function splitParts(digits: string): CnjParts {
  return {
    sequential: digits.slice(0, 7),
    checkDigits: digits.slice(7, 9),
    year: digits.slice(9, 13),
    segment: digits.slice(13, 14),
    court: digits.slice(14, 16),
    unit: digits.slice(16, 20),
  };
}

/** The check digits are computed over the other eighteen digits in their canonical order. */
export function cnjCheckDigits(parts: Omit<CnjParts, 'checkDigits'>): string {
  const base = `${parts.sequential}${parts.year}${parts.segment}${parts.court}${parts.unit}`;
  return String(98 - mod97(`${base}00`)).padStart(2, '0');
}

export function parseCnjNumber(value: string): CnjParseResult {
  const raw = value.trim();
  if (!raw) return { ok: false, reason: 'characters' };
  // Anything other than digits and the documented separators means this is not a CNJ number at
  // all, rather than a CNJ number typed badly.
  if (!/^[\d.\-/\s]+$/.test(raw)) return { ok: false, reason: 'characters' };

  const digits = stripCnjPunctuation(raw);
  if (digits.length !== 20) return { ok: false, reason: 'length' };
  if (!DIGITS_ONLY.test(digits)) return { ok: false, reason: 'characters' };

  const parts = splitParts(digits);
  const year = Number(parts.year);
  // The numbering scheme predates the resolution but not by centuries; a year outside this range
  // is a transcription error, not a historical proceeding.
  if (year < 1900 || year > 2200) return { ok: false, reason: 'year' };
  if (cnjCheckDigits(parts) !== parts.checkDigits) return { ok: false, reason: 'check_digits' };

  return {
    ok: true,
    normalized: digits,
    formatted: formatCnjNumber(digits),
    parts,
  };
}

/** Canonical display form. Storage always keeps the twenty bare digits. */
export function formatCnjNumber(digits: string): string {
  const value = stripCnjPunctuation(digits);
  if (value.length !== 20) return digits;
  const parts = splitParts(value);
  return `${parts.sequential}-${parts.checkDigits}.${parts.year}.${parts.segment}.${parts.court}.${parts.unit}`;
}

export function isValidCnjNumber(value: string): boolean {
  return parseCnjNumber(value).ok;
}
