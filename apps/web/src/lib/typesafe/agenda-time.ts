import { Temporal } from '@js-temporal/polyfill';

export function validTimeZone(value: string) {
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: value }).format(); return true; } catch { return false; }
}
export function localInstant(day: string, time: string, timeZone: string) {
  // Reject both nonexistent and repeated local times; the person must disambiguate.
  if (!validTimeZone(timeZone)) throw new RangeError('Informe um fuso horário válido.');
  let local: Temporal.PlainDateTime;
  try { local = Temporal.PlainDateTime.from(`${day}T${time}`, { overflow: 'reject' }); }
  catch { throw new RangeError('Informe uma data e um horário válidos.'); }
  try { return local.toZonedDateTime(timeZone, { disambiguation: 'reject' }).toInstant().toString(); }
  catch { throw new RangeError('Esse horário não existe ou se repete na mudança de horário de verão desse fuso. Escolha outro horário válido.'); }
}
export function temporalCandidates(message: string, referenceAt: string, timeZone: string) {
  const dates = new Set<string>(); const times = new Set<string>(); const questions: string[] = [];
  if (!validTimeZone(timeZone)) return { dates: [], times: [], questions: ['Informe o fuso para interpretar as datas.'] };
  const today = Temporal.Instant.from(referenceAt).toZonedDateTimeISO(timeZone).toPlainDate();
  const text = message.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  for (const match of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b|\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    try { dates.add(Temporal.PlainDate.from(match[1] || `${match[4]}-${match[3].padStart(2, '0')}-${match[2].padStart(2, '0')}`, { overflow: 'reject' }).toString()); }
    catch { questions.push('Confira a data informada.'); }
  }
  if (/\bhoje\b/.test(text)) dates.add(today.toString());
  if (/\bamanha\b/.test(text)) dates.add(today.add({ days: /depois de amanha/.test(text) ? 2 : 1 }).toString());
  const relative = /\bdaqui a (\d{1,3}) dias?\b/.exec(text);
  if (relative) dates.add(today.add({ days: Number(relative[1]) }).toString());
  const weekdays = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
  if (weekdays.some(day => text.includes(day)) && !dates.size) questions.push('Informe a data completa do dia da semana mencionado.');
  if (/\b\d{1,2}\/\d{1,2}(?!\/\d{4})\b/.test(text) && !dates.size) questions.push('Informe o ano da data.');
  for (const match of text.matchAll(/\b(\d{1,2})(?::|h)(\d{2})?\b|\bas?\s+(\d{1,2})(?!\d)\b/g)) {
    const hour = Number(match[1] ?? match[3]); const minute = Number(match[2] ?? 0);
    if (hour < 24 && minute < 60) times.add(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    else questions.push('Confira o horário informado.');
  }
  return { dates: [...dates], times: [...times], questions };
}
