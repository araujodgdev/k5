import assert from 'node:assert/strict';
import test from 'node:test';
import { timeZoneLabel } from '../src/lib/time-zone-label';

// The wording comes from the runtime's ICU data, which is not pinned: check the shape, not the words.
test('the agenda names the time zone in Portuguese instead of showing its IANA id', () => {
  const saoPaulo = timeZoneLabel('America/Sao_Paulo');
  const recife = timeZoneLabel('America/Recife');
  const english = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', timeZoneName: 'longGeneric' })
    .formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value;
  assert.ok(saoPaulo.trim());
  assert.notEqual(saoPaulo, english, 'the label is in Portuguese, not the runtime default');
  assert.equal(saoPaulo, recife);
  for (const label of [saoPaulo, recife, timeZoneLabel('America/Manaus')]) {
    assert.doesNotMatch(label, /America\//);
    assert.doesNotMatch(label, /Padrão/);
  }
});

test('an unknown or empty zone falls back without throwing', () => {
  assert.equal(timeZoneLabel('Nao/Existe'), 'Nao/Existe');
  assert.equal(timeZoneLabel(''), '');
});
