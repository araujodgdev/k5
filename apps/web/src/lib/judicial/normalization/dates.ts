/**
 * Court sources publish dates at whatever precision they hold. Section 6 of the plan: keep the
 * original timezone and precision, and never invent a time for a date that had none.
 *
 * A movement dated "12/03/2025" becomes `2025-03-12` with precision `date`. Turning it into
 * `2025-03-12T00:00:00Z` would silently place it on the previous day in Brasília and make a
 * deadline computed from it wrong by one day.
 */

export type DatePrecision = 'date' | 'minute' | 'second';

export type SourceDate = {
  /** ISO 8601, truncated to the precision the source actually provided. */
  value: string;
  precision: DatePrecision;
  /** Offset as the source wrote it, or null when it published a local date with no zone. */
  timezone: string | null;
};

const ISO_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR_DATE = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const COMPACT_DATE = /^(\d{4})(\d{2})(\d{2})$/;

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function normalizeZone(zone: string | undefined): string | null {
  if (!zone) return null;
  if (zone === 'Z') return 'Z';
  const compact = zone.replace(':', '');
  return `${compact.slice(0, 3)}:${compact.slice(3)}`;
}

/**
 * Parses the formats Brazilian court sources actually emit. Returns null rather than guessing:
 * an unparseable date belongs in the rejected count, not in a row with a plausible-looking value.
 */
export function parseSourceDate(input: string | null | undefined): SourceDate | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  const compact = COMPACT_DATE.exec(raw);
  if (compact) {
    const [, year, month, day] = compact;
    if (!isRealDate(Number(year), Number(month), Number(day))) return null;
    return { value: `${year}-${month}-${day}`, precision: 'date', timezone: null };
  }

  const dateOnly = ISO_DATE_ONLY.exec(raw);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    if (!isRealDate(Number(year), Number(month), Number(day))) return null;
    return { value: raw, precision: 'date', timezone: null };
  }

  const withZone = ISO_WITH_ZONE.exec(raw);
  if (withZone) {
    const [, year, month, day, hour, minute, second, zone] = withZone;
    if (!isRealDate(Number(year), Number(month), Number(day))) return null;
    if (Number(hour) > 23 || Number(minute) > 59 || (second && Number(second) > 59)) return null;
    const base = `${year}-${month}-${day}T${hour}:${minute}`;
    return second
      ? { value: `${base}:${second}`, precision: 'second', timezone: normalizeZone(zone) }
      : { value: base, precision: 'minute', timezone: normalizeZone(zone) };
  }

  const brazilian = BR_DATE.exec(raw);
  if (brazilian) {
    const [, day, month, year, hour, minute, second] = brazilian;
    if (!isRealDate(Number(year), Number(month), Number(day))) return null;
    if (!hour) return { value: `${year}-${month}-${day}`, precision: 'date', timezone: null };
    if (Number(hour) > 23 || Number(minute) > 59 || (second && Number(second) > 59)) return null;
    const base = `${year}-${month}-${day}T${hour}:${minute}`;
    // Courts publish local times without an offset. Recording `null` says "we do not know the
    // zone", which is true and checkable; assuming -03:00 would be neither.
    return second
      ? { value: `${base}:${second}`, precision: 'second', timezone: null }
      : { value: base, precision: 'minute', timezone: null };
  }

  return null;
}

/** Calendar day of a source date, for grouping an inbox without pretending to know the hour. */
export function sourceDay(date: SourceDate | null): string | null {
  return date ? date.value.slice(0, 10) : null;
}

/** The instant K5 acted, always UTC and always at second precision. */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Inclusive window for an incremental sweep. The overlap is deliberate (section 7 step 6): a
 * source that publishes late would otherwise fall into the gap between two exact windows.
 */
export function overlappingWindow(watermark: string | null, until: string, overlapDays: number): { from: string; to: string } {
  const end = until.slice(0, 10);
  if (!watermark) return { from: end, to: end };
  const start = new Date(`${watermark.slice(0, 10)}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - overlapDays);
  const from = start.toISOString().slice(0, 10);
  return { from: from < end ? from : end, to: end };
}

/** Days between two ISO dates, used to refuse a window wider than the source documents. */
export function windowDays(from: string, to: string): number {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return Number.NaN;
  return Math.round((end - start) / 86_400_000) + 1;
}
