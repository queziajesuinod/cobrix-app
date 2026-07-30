const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  effectiveBillingDay,
  dueDateForMonth,
  normalizeBillingIntervalMonths,
  isBillingMonthFor,
} = require('../src/jobs/billing-cron');

test('effectiveBillingDay: clampa o dia ao último dia do mês', () => {
  assert.equal(effectiveBillingDay(new Date(2026, 1, 15), 31), 28); // fev/2026 = 28 dias
  assert.equal(effectiveBillingDay('2026-04-10', 31), 30);          // abr = 30 dias
  assert.equal(effectiveBillingDay('2026-07-10', 10), 10);          // dia normal
});

test('dueDateForMonth: monta a data de vencimento do mês com clamp', () => {
  const feb = dueDateForMonth('2026-02-01', 31);
  assert.equal(feb.getMonth(), 1);
  assert.equal(feb.getDate(), 28);

  const jul = dueDateForMonth('2026-07-01', 15);
  assert.equal(jul.getMonth(), 6);
  assert.equal(jul.getDate(), 15);
});

test('normalizeBillingIntervalMonths: só aceita 1, 3 ou 12; resto vira 1', () => {
  assert.equal(normalizeBillingIntervalMonths(3), 3);
  assert.equal(normalizeBillingIntervalMonths(12), 12);
  assert.equal(normalizeBillingIntervalMonths(1), 1);
  assert.equal(normalizeBillingIntervalMonths(6), 1);
  assert.equal(normalizeBillingIntervalMonths(0), 1);
  assert.equal(normalizeBillingIntervalMonths(-5), 1);
  assert.equal(normalizeBillingIntervalMonths('abc'), 1);
});

test('isBillingMonthFor: mensal (intervalo 1) cobra todo mês', () => {
  const c = { start_date: '2026-01-15', billing_interval_months: 1 };
  assert.equal(isBillingMonthFor(c, '2026-01-20'), true);
  assert.equal(isBillingMonthFor(c, '2026-05-20'), true);
});

test('isBillingMonthFor: trimestral cobra só nos meses do ciclo', () => {
  const c = { start_date: '2026-01-10', billing_interval_months: 3 };
  assert.equal(isBillingMonthFor(c, '2026-01-10'), true);  // diff 0
  assert.equal(isBillingMonthFor(c, '2026-02-10'), false); // diff 1
  assert.equal(isBillingMonthFor(c, '2026-04-10'), true);  // diff 3
  assert.equal(isBillingMonthFor(c, '2025-12-10'), false); // antes do início
});

test('isBillingMonthFor: sem start_date assume verdadeiro', () => {
  assert.equal(isBillingMonthFor({ billing_interval_months: 3 }, '2026-04-10'), true);
});
