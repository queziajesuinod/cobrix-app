// Testa as primitivas de enforcement (re-parent reversível + status de revenda)
// com um mock de ../db injetado no require.cache antes de carregar o serviço.
const { test } = require('node:test');
const assert = require('node:assert/strict');

let calls = [];
function fakeQuery(sql, params = []) {
  calls.push({ sql: String(sql).replace(/\s+/g, ' '), params });
  return { rowCount: 1, rows: [] };
}

const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: fakeQuery } };
const enf = require('../src/services/reseller-enforcement');

test('reparentToPadrao: salva o pai original (COALESCE) e zera parent, só se tiver pai', async () => {
  calls = [];
  const r = await enf.reparentToPadrao(5);
  assert.equal(r.reparented, 1);
  const c = calls[0];
  assert.ok(c.sql.includes('original_parent_partner_id = COALESCE(original_parent_partner_id, parent_partner_id)'));
  assert.ok(c.sql.includes('parent_partner_id = NULL'));
  assert.ok(c.sql.includes('WHERE id = $1 AND parent_partner_id IS NOT NULL'));
  assert.deepEqual(c.params, [5]);
});

test('restoreParent: devolve o pai original e limpa, só se estava re-parenteado', async () => {
  calls = [];
  const r = await enf.restoreParent(5);
  assert.equal(r.restored, 1);
  const c = calls[0];
  assert.ok(c.sql.includes('parent_partner_id = original_parent_partner_id'));
  assert.ok(c.sql.includes('original_parent_partner_id = NULL'));
  assert.ok(c.sql.includes('WHERE id = $1 AND original_parent_partner_id IS NOT NULL'));
  assert.deepEqual(c.params, [5]);
});

test('setResellerStatus: atualiza reseller_status', async () => {
  calls = [];
  await enf.setResellerStatus(5, 'link_locked');
  assert.ok(calls[0].sql.includes('reseller_status = $2'));
  assert.deepEqual(calls[0].params, [5, 'link_locked']);
});

test('markResellerDelinquent: só marca se ainda não marcado (COALESCE)', async () => {
  calls = [];
  await enf.markResellerDelinquent(5, '2026-05-01');
  assert.ok(calls[0].sql.includes('COALESCE(reseller_delinquent_since, $2::date)'));
  assert.deepEqual(calls[0].params, [5, '2026-05-01']);
});

test('clearResellerDelinquency: volta active e zera o relógio', async () => {
  calls = [];
  await enf.clearResellerDelinquency(5);
  assert.ok(calls[0].sql.includes("reseller_status = 'active'"));
  assert.ok(calls[0].sql.includes('reseller_delinquent_since = NULL'));
  assert.deepEqual(calls[0].params, [5]);
});

test('usa o client de transação quando passado', async () => {
  const clientCalls = [];
  const client = { query: (sql, params) => { clientCalls.push({ sql, params }); return { rowCount: 1 }; } };
  calls = [];
  await enf.setResellerStatus(9, 'network_seized', client);
  assert.equal(calls.length, 0, 'não deve usar o pool');
  assert.equal(clientCalls.length, 1, 'deve usar o client');
  assert.deepEqual(clientCalls[0].params, [9, 'network_seized']);
});
