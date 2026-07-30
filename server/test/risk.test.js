const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeRiskScore } = require('../src/services/risk');

test('sem cobranças → sem histórico (score null)', () => {
  const r = computeRiskScore({ total_billings: 0 });
  assert.equal(r.score, null);
  assert.equal(r.band, 'sem_historico');
});

test('bom pagador → risco baixo', () => {
  const r = computeRiskScore({
    total_billings: 12, total_paid: 12, paid_late: 0, avg_days_late: 0,
    open_overdue_count: 0, max_open_days: 0, open_overdue_amount: 0,
  });
  assert.equal(r.band, 'baixo');
  assert.ok(r.score <= 33);
  assert.deepEqual(r.factors.map((f) => f.key), ['ok']);
});

test('inadimplente crônico → risco alto', () => {
  const r = computeRiskScore({
    total_billings: 10, total_paid: 8, paid_late: 8, avg_days_late: 40,
    open_overdue_count: 4, max_open_days: 90, open_overdue_amount: 5000,
  });
  assert.equal(r.band, 'alto');
  assert.ok(r.score >= 67, `score=${r.score}`);
});

test('atraso moderado → risco médio', () => {
  const r = computeRiskScore({
    total_billings: 6, total_paid: 5, paid_late: 3, avg_days_late: 8,
    open_overdue_count: 1, max_open_days: 20, open_overdue_amount: 800,
  });
  assert.equal(r.band, 'medio');
  assert.ok(r.score >= 34 && r.score <= 66, `score=${r.score}`);
});

test('fatores explicáveis são gerados a partir das métricas', () => {
  const r = computeRiskScore({
    total_billings: 5, total_paid: 4, paid_late: 2, avg_days_late: 10,
    open_overdue_count: 2, max_open_days: 45, open_overdue_amount: 1200,
  });
  const keys = r.factors.map((f) => f.key);
  assert.ok(keys.includes('open_count'));
  assert.ok(keys.includes('open_days'));
  assert.ok(keys.includes('late_rate'));
  assert.ok(keys.includes('avg_days'));
});

test('score é sempre 0..100', () => {
  const extreme = computeRiskScore({
    total_billings: 100, total_paid: 100, paid_late: 100, avg_days_late: 999,
    open_overdue_count: 99, max_open_days: 999, open_overdue_amount: 999999,
  });
  assert.ok(extreme.score >= 0 && extreme.score <= 100);
  assert.equal(extreme.score, 100);
});
