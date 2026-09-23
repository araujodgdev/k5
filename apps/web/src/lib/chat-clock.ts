/** The agent writes on its own; without "today" it cannot turn "amanhã às 10h" into a date. */
export function clockContext(now: Date, timeZone: string) {
  const zone = (() => { try { new Intl.DateTimeFormat('pt-BR', { timeZone }); return timeZone; } catch { return 'America/Sao_Paulo'; } })();
  const local = new Intl.DateTimeFormat('pt-BR', { timeZone: zone, dateStyle: 'full', timeStyle: 'short' }).format(now);
  const iso = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(now)
    .find(part => part.type === 'timeZoneName')?.value.replace('GMT', '') || '+00:00';
  return `Agora é ${local} (data ${iso}, fuso ${zone}, offset ${offset}). Use esta data como referência para "hoje", "amanhã" e dias da semana.`;
}
