import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listProviderConversations, listProviderMessages } from '../src/lib/whatsapp/provider';
import { withWhatsAppTransport } from '../src/lib/whatsapp/transport';

const createdAt = '2020-01-01T12:00:00.000Z';
const thread = { id: 'thread', accountId: 'account', platform: 'whatsapp', participantId: 'person', updatedTime: createdAt };
const message = { id: 'wamid.message', conversationId: 'internal-thread', accountId: 'account', platform: 'whatsapp',
  message: 'Original', direction: 'incoming', createdAt };
const pagination = { hasMore: false, nextCursor: null };

function messages(value: unknown) {
  return withWhatsAppTransport(async () => Response.json({ messages: [value], pagination }),
    () => listProviderMessages('tenant-key', 'account', 'thread'));
}

test('documented null unread counts keep the whole conversation page readable', async () => {
  const page = await withWhatsAppTransport(async () => Response.json({
    data: [{ ...thread, unreadCount: null }, { ...thread, id: 'without-count' }], pagination,
  }), () => listProviderConversations('tenant-key', 'account', 'profile'));
  assert.deepEqual(page.items.map(item => ({ id: item.id, unreadCount: item.unreadCount })),
    [{ id: 'thread', unreadCount: 0 }, { id: 'without-count', unreadCount: 0 }]);
});

test('history exposes successive edit versions without changing the message identity or creation time', async () => {
  const first = await messages({ ...message, message: 'Primeira edição', isEdited: true, editedAt: '2020-01-01T10:00:00-03:00' });
  const second = await messages({ ...message, message: 'Segunda edição', isEdited: true, editedAt: '2020-01-01T14:00:00Z' });
  assert.deepEqual(first.items.map(item => [item.id, item.createdAt, item.contentUpdatedAt, item.text]),
    [['wamid.message', createdAt, '2020-01-01T13:00:00.000Z', 'Primeira edição']]);
  assert.deepEqual(second.items.map(item => [item.id, item.createdAt, item.contentUpdatedAt, item.text]),
    [['wamid.message', createdAt, '2020-01-01T14:00:00.000Z', 'Segunda edição']]);
  assert.ok(Date.parse(second.items[0].contentUpdatedAt) > Date.parse(first.items[0].contentUpdatedAt));
});

test('history without an edit timestamp uses the original content version', async () => {
  for (const value of [message, { ...message, editedAt: null }]) {
    const page = await messages(value);
    assert.equal(page.items[0].contentUpdatedAt, createdAt);
  }
});

test('conversation dates cannot move previews beyond the accepted clock skew', async t => {
  const now = Date.parse('2020-02-01T00:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const read = (updatedTime: string) => withWhatsAppTransport(async () => Response.json({
    data: [{ ...thread, updatedTime }], pagination,
  }), () => listProviderConversations('tenant-key', 'account', 'profile'));
  const accepted = await read(new Date(now + 60_000).toISOString());
  assert.equal(accepted.items[0].updatedAt, '2020-02-01T00:01:00.000Z');
  await assert.rejects(() => read(new Date(now + 60_001).toISOString()),
    { status: 200, code: 'invalid_response', isAmbiguous: true });
});

test('message creation and edit dates reject future or inverted content versions', async t => {
  const now = Date.parse('2020-02-01T00:00:00Z');
  t.mock.method(Date, 'now', () => now);
  for (const value of [
    { ...message, createdAt: new Date(now + 60_001).toISOString() },
    { ...message, isEdited: true, editedAt: new Date(now + 60_001).toISOString() },
    { ...message, isEdited: true, editedAt: '2020-01-01T11:59:59Z' },
    { ...message, isEdited: true, editedAt: 'invalid' },
  ]) {
    await assert.rejects(() => messages(value), { status: 200, code: 'invalid_response', isAmbiguous: true });
  }
  const accepted = await messages({ ...message, isEdited: true, editedAt: new Date(now + 60_000).toISOString() });
  assert.equal(accepted.items[0].contentUpdatedAt, '2020-02-01T00:01:00.000Z');
});
