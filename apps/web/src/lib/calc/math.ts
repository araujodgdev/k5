import Decimal from 'decimal.js';

export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export function cents(value: Decimal.Value): number {
  const result = new D(value).toDecimalPlaces(0).toNumber();
  if (!Number.isSafeInteger(result) || Math.abs(result) > 99_999_999_999_999) throw new Error('O resultado excede o limite permitido.');
  return result;
}
export const monthOf = (day: string) => day.slice(0, 7);
export function nextMonth(month: string): string {
  const [year, value] = month.split('-').map(Number);
  return value === 12 ? `${year + 1}-01` : `${year}-${String(value + 1).padStart(2, '0')}`;
}
export function monthRange(first: string, last: string): string[] {
  const months: string[] = [];
  for (let month = first; month <= last; month = nextMonth(month)) {
    if (months.length >= 1272) throw new Error('O período excede o limite permitido.');
    months.push(month);
  }
  return months;
}
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
export function monthParts(from: string, to: string) {
  return monthRange(monthOf(from), monthOf(to)).flatMap(month => {
    const first = `${month}-01`; const next = `${nextMonth(month)}-01`;
    const start = from > first ? from : first; const end = to < next ? to : next;
    const days = daysBetween(start, end);
    return days > 0 ? [{ month, days, monthDays: daysBetween(first, next) }] : [];
  });
}
