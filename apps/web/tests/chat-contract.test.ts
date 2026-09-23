import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatRequestSchema } from '../src/lib/chat-contract';

// The real transport sends null when no case is selected, including a plain greeting.
const request = {
  conversationId: 'conversation', caseId: null, documentIds: [], researchReferenceIds: [],
  message: { role: 'user', parts: [{ type: 'text', text: 'Oi' }], metadata: { custom: {} }, id: 'message' },
  trigger: 'submit-message',
};
test('chat accepts the transport request without a selected case', () => {
  const parsed = chatRequestSchema.parse(request);
  assert.equal(parsed.caseId, undefined);
  assert.equal(parsed.message.parts[0].text, 'Oi');
});
test('chat preserves a selected case and rejects malformed context', () => {
  assert.equal(chatRequestSchema.parse({ ...request, caseId: 'selected-case' }).caseId, 'selected-case');
  assert.equal(chatRequestSchema.safeParse({ ...request, caseId: 123 }).success, false);
  assert.equal(chatRequestSchema.safeParse({ ...request, message: undefined }).success, false);
});
