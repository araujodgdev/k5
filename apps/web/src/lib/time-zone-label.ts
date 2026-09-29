/**
 * The zone's name in Portuguese ("Horário de Brasília"), for text a person reads, instead of its
 * IANA id ("America/Sao_Paulo"). Falls back to the id when the runtime has no name for it.
 */
export function timeZoneLabel(timeZone: string, now = new Date()): string {
  if (!timeZone) return '';
  try {
    const name = new Intl.DateTimeFormat('pt-BR', { timeZone, timeZoneName: 'longGeneric' })
      .formatToParts(now).find(part => part.type === 'timeZoneName')?.value;
    // Some ICU builds call the generic name "Horário Padrão de …"; the zone has no summer time to tell apart.
    return name ? name.replace(/^Horário Padrão /, 'Horário ') : timeZone;
  } catch {
    return timeZone;
  }
}
