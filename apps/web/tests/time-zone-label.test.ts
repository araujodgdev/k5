import assert from 'node:assert/strict';
import test from 'node:test';
import { timeZoneLabel } from '../src/lib/time-zone-label';

test('the agenda names the time zone in Portuguese instead of showing its IANA id', () => {
  assert.equal(timeZoneLabel('America/Sao_Paulo'), 'Horário de Brasília');
  assert.equal(timeZoneLabel('America/Recife'), 'Horário de Brasília');
  assert.doesNotMatch(timeZoneLabel('America/Manaus'), /America\//);
});

test('an unknown or empty zone falls back without throwing', () => {
  assert.equal(timeZoneLabel('Nao/Existe'), 'Nao/Existe');
  assert.equal(timeZoneLabel(''), '');
});
