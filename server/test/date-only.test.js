const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ensureDateOnly, formatISODate, addDays } = require('../src/utils/date-only');

test('ensureDateOnly: string YYYY-MM-DD vira Date local sem shift de timezone', () => {
  const d = ensureDateOnly('2026-07-30');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 6); // julho (0-based)
  assert.equal(d.getDate(), 30);
});

test('ensureDateOnly: remove a parte de horário de um Date', () => {
  const d = ensureDateOnly(new Date(2026, 6, 30, 23, 59, 59));
  assert.equal(d.getHours(), 0);
  assert.equal(d.getDate(), 30);
});

test('ensureDateOnly: entradas inválidas', () => {
  assert.equal(ensureDateOnly(null), null);
  assert.equal(ensureDateOnly('não é data'), null);
});

test('formatISODate: zero-pad e round-trip', () => {
  assert.equal(formatISODate(new Date(2026, 6, 5)), '2026-07-05');
  assert.equal(formatISODate('2026-07-30'), '2026-07-30');
  assert.equal(formatISODate(null), null);
});

test('addDays: soma cruzando fim de mês', () => {
  assert.equal(formatISODate(addDays('2026-07-30', 4)), '2026-08-03');
  assert.equal(formatISODate(addDays('2026-01-31', 1)), '2026-02-01');
});

test('addDays: subtração cruzando início de mês (sem off-by-one de TZ)', () => {
  // 2026 não é bissexto — 01/03 menos 1 dia = 28/02
  assert.equal(formatISODate(addDays('2026-03-01', -1)), '2026-02-28');
});
