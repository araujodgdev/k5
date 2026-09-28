import { civilDate } from '@/lib/honorarios/contracts';

export const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
export const amountInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
export const dateLabel = (day: string) => day.split('-').reverse().join('/');

export function parseAmount(text: string): number | null {
  const value = text.trim().replace(/^R\$\s*/, '');
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(value)) return null;
  const [whole = '', fraction = ''] = value.replaceAll('.', '').split(',');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 99_999_999_999 ? cents : null;
}

export type InstallmentDraft = { amount: string; dueOn: string };

export function monthlySchedule(totalCents: number, count: number, firstDate: string): InstallmentDraft[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < count || totalCents > 99_999_999_999 || !Number.isInteger(count) || count < 1 || count > 120 || !civilDate.safeParse(firstDate).success) return [];
  const [year = 0, month = 0, day = 0] = firstDate.split('-').map(Number);
  if (year * 12 + month - 1 + count - 1 >= 10000 * 12) return [];
  return Array.from({ length: count }, (_, index) => {
    const absoluteMonth = year * 12 + month - 1 + index;
    const nextYear = Math.floor(absoluteMonth / 12);
    const nextMonth = absoluteMonth % 12 + 1;
    const leap = nextYear % 4 === 0 && (nextYear % 100 !== 0 || nextYear % 400 === 0);
    const monthDays = nextMonth === 2 ? leap ? 29 : 28 : [4, 6, 9, 11].includes(nextMonth) ? 30 : 31;
    const dueOn = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-${String(Math.min(day, monthDays)).padStart(2, '0')}`;
    const value = Math.floor(totalCents / count) + (index === count - 1 ? totalCents % count : 0);
    return { amount: amountInput(value), dueOn };
  });
}
