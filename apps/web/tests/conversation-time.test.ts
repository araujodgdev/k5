import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conversationDate, formatConversationTime } from '../src/lib/conversation-time';

// Pin a non-UTC zone so a regression cannot be hidden by a UTC CI runner.
process.env.TZ = 'America/Sao_Paulo';

test('SQLite conversation timestamps identify UTC instants in every browser timezone', () => {
  const now = Date.parse('2026-09-22T14:00:00Z');
  assert.equal(conversationDate('2026-09-22 12:00:00').toISOString(), '2026-09-22T12:00:00.000Z');
  assert.equal(formatConversationTime('2026-09-22 12:00:00', now), '2 h');
  assert.equal(formatConversationTime('2026-09-22T09:00:00-03:00', now), '2 h');
  assert.equal(conversationDate('2026-09-22 12:00:00.123').toISOString(), '2026-09-22T12:00:00.123Z');
});

test('conversation age preserves recent, minute and invalid timestamp labels', () => {
  const now = Date.parse('2026-09-22T14:00:00Z');
  assert.equal(formatConversationTime('2026-09-22 13:59:40', now), 'Agora');
  assert.equal(formatConversationTime('2026-09-22 13:40:00', now), '20 min');
  assert.equal(formatConversationTime('invalid', now), 'Agora');
});
