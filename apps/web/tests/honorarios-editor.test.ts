import assert from 'node:assert/strict';
import test from 'node:test';
import { monthlySchedule, parseAmount } from '../src/components/honorarios/editor';

test('honorários parses Brazilian amounts without silently changing separators or rounding', () => {
  for (const value of ['1.234,56', '1234,56', 'R$ 1.234,56']) assert.equal(parseAmount(value), 123456);
  assert.equal(parseAmount('10,5'), 1050);
  assert.equal(parseAmount('0,01'), 1);
  assert.equal(parseAmount('1.000'), 100000);
  for (const value of ['', '0', '-1,00', '1.23', '1,234', '1,000.00', '12.34,56', '1e3', '1000000000,00']) assert.equal(parseAmount(value), null, value);
});

test('honorários preserves every cent and the original month day when generating installments', () => {
  assert.deepEqual(monthlySchedule(10000, 3, '2028-01-31'), [
    { amount: '33,33', dueOn: '2028-01-31' },
    { amount: '33,33', dueOn: '2028-02-29' },
    { amount: '33,34', dueOn: '2028-03-31' },
  ]);
  assert.deepEqual(monthlySchedule(300, 3, '2026-12-31').map(row => row.dueOn), ['2026-12-31', '2027-01-31', '2027-02-28']);
  assert.deepEqual(monthlySchedule(300, 3, '2100-01-31').map(row => row.dueOn), ['2100-01-31', '2100-02-28', '2100-03-31']);
});

test('honorários refuses schedules with zero-value installments, invalid dates and excessive counts', () => {
  assert.deepEqual(monthlySchedule(2, 3, '2028-01-31'), []);
  assert.deepEqual(monthlySchedule(10000, 121, '2028-01-31'), []);
  assert.deepEqual(monthlySchedule(10000, 0, '2028-01-31'), []);
  assert.deepEqual(monthlySchedule(10000, 2, '2027-02-29'), []);
  assert.deepEqual(monthlySchedule(10000, 2.5, '2028-01-31'), []);
});
