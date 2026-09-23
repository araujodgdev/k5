import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { blockTexts, changedBlocks } from '../src/components/document/change-blocks';
import { clampChatShare, MAX_CHAT_SHARE, MIN_CHAT_SHARE } from '../src/lib/document-split';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    list: { group: 'block', content: 'paragraph+' },
    text: {},
  },
});
const paragraph = (text: string) => schema.node('paragraph', null, text ? [schema.text(text)] : []);
const doc = (...blocks: ReturnType<typeof paragraph>[]) => schema.node('doc', null, blocks);

test('document panel: only reworded or new blocks are marked, nested ones included', () => {
  const before = doc(paragraph('Prezado senhor,'), paragraph('O aluguel está   atrasado.'), schema.node('list', null, [paragraph('Item um')]));
  assert.deepEqual(blockTexts(before), ['Prezado senhor,', 'O aluguel está atrasado.', 'Item um']);

  const after = doc(paragraph('Prezado senhor,'), paragraph('O aluguel está atrasado há 40 dias.'), schema.node('list', null, [paragraph('Item um'), paragraph('Item dois')]), paragraph(''));
  const changed = changedBlocks(after, blockTexts(before)).map(({ from, to }) => after.textBetween(from, to));
  assert.deepEqual(changed, ['O aluguel está atrasado há 40 dias.', 'Item dois']);
  // Whitespace alone is not a change, and an empty paragraph is never marked.
  assert.deepEqual(changedBlocks(before, blockTexts(before)), []);
});

test('document panel: the conversation share stays between its bounds', () => {
  assert.equal(clampChatShare(10), MIN_CHAT_SHARE);
  assert.equal(clampChatShare(95), MAX_CHAT_SHARE);
  assert.equal(clampChatShare(41.26), 41.3);
});
