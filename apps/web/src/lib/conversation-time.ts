/** PostgreSQL timestamps reach the client as ISO strings with an offset. */
export function conversationDate(timestamp: string) {
  return new Date(timestamp);
}

export function formatConversationTime(timestamp: string, now = Date.now()) {
  const date = conversationDate(timestamp);
  const delta = now - date.getTime();
  if (!Number.isFinite(delta) || delta < 45_000) return 'Agora';
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
}
