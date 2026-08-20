// Testa o cron do lifecycle de inadimplência da revenda com um mock de ../db
// injetado no require.cache antes de carregar o serviço (e suas dependências).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const PADRAO = 1;
let scenario = null;
let cap = null;

function fakeQuery(sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ');
  // padrão (is_saas_owner)
  if (s.includes('is_saas_owner')) return { rows: [{ id: PADRAO }] };
  // agregado de parceiros inadimplentes
  if (s.includes('AS partner_id') && s.includes('MIN(CASE')) {
    return { rows: scenario.due.map((d) => ({ partner_id: d.partner_id, oldest: d.oldest, total: d.total })) };
  }
  // markResellerDelinquent
  if (s.includes('reseller_delinquent_since = COALESCE')) { cap.mark.push(params); return { rows: [] }; }
  // setResellerStatus
  if (s.includes('SET reseller_status = $2')) { cap.status.push(params); return { rowCount: 1 }; }
  // lockChildren (select dos filhos parceiros)
  if (s.includes('reparent_target_id AS child_id')) {
    return { rows: (scenario.kids[params[1]] || []).map((id) => ({ child_id: id })) };
  }
  // reparentToPadrao
  if (s.includes('original_parent_partner_id = COALESCE')) { cap.reparent.push(params); return { rowCount: 1 }; }
  // createNotification
  if (s.includes('INSERT INTO') && s.includes('notifications')) return { rows: [{ id: 1 }] };
  // resolvePartnerContact (sem telefone → sem WhatsApp)
  if (s.includes('company_subscriptions') && s.includes('cl.phone')) return { rows: [{ name: 'P', phone: null, email: null, cpf: null, cnpj: null }] };
  // flagged (varredura de reversão)
  if (s.includes('SELECT id FROM') && s.includes("reseller_status <> 'active'")) return { rows: scenario.flagged };
  // revert: guarda de status
  if (s.includes('reseller_status, reseller_delinquent_since') && s.includes('WHERE id =')) {
    return { rows: [{ reseller_status: 'link_locked', reseller_delinquent_since: '2026-01-01' }] };
  }
  // revert: ainda deve algo?
  if (s.includes('SELECT 1 FROM') && s.includes('partner_commissions')) {
    return { rows: scenario.revertStillDue ? [{ x: 1 }] : [] };
  }
  // revert: filhos re-parenteados por este parceiro
  if (s.includes('SELECT id FROM') && s.includes('original_parent_partner_id = $1')) {
    return { rows: (scenario.revertKids || []).map((id) => ({ id })) };
  }
  // restoreParent
  if (s.includes('parent_partner_id = original_parent_partner_id')) { cap.restore.push(params); return { rowCount: 1 }; }
  // clearResellerDelinquency
  if (s.includes("reseller_status = 'active'") && s.includes('reseller_delinquent_since = NULL')) { cap.clear.push(params); return { rowCount: 1 }; }
  throw new Error('Query não mapeada: ' + s.slice(0, 100));
}

const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: fakeQuery } };
const { runResellerDelinquencyCron, monthsBetween } = require('../src/services/reseller-delinquency');

function reset() { cap = { mark: [], status: [], reparent: [], restore: [], clear: [] }; }

test('monthsBetween conta meses inteiros de calendário', () => {
  assert.equal(monthsBetween(new Date(2026, 3, 20), new Date(2026, 7, 20)), 4);
  assert.equal(monthsBetween(new Date(2026, 0, 20), new Date(2026, 7, 20)), 7);
  assert.equal(monthsBetween(new Date(2026, 7, 25), new Date(2026, 7, 20)), 0); // mesmo mês, dia menor
});

test('>= 3 meses: trava a revenda (link_locked) e re-parenteia o sub-parceiro', async () => {
  reset();
  scenario = {
    due: [{ partner_id: 2, oldest: new Date(2026, 3, 20), total: 30 }], // 4 meses
    kids: { 2: [5] }, // sub-parceiro 5 sob o 2
    flagged: [],
  };
  const out = await runResellerDelinquencyCron(new Date(2026, 7, 20));
  assert.equal(out.resellerLocked, 1);
  assert.equal(out.resellerSeized, 0);
  assert.deepEqual(cap.status[0], [2, 'link_locked']);
  assert.deepEqual(cap.reparent[0], [5], 'sub-parceiro 5 movido pra Padrão');
});

test('>= 6 meses: toma a rede (network_seized)', async () => {
  reset();
  scenario = {
    due: [{ partner_id: 2, oldest: new Date(2026, 0, 20), total: 90 }], // 7 meses
    kids: { 2: [5] },
    flagged: [],
  };
  const out = await runResellerDelinquencyCron(new Date(2026, 7, 20));
  assert.equal(out.resellerSeized, 1);
  assert.deepEqual(cap.status[0], [2, 'network_seized']);
});

test('reversão: parceiro marcado que já não deve nada é restaurado e destravado', async () => {
  reset();
  scenario = {
    due: [],                 // ninguém mais inadimplente
    kids: {},
    flagged: [{ id: 2 }],    // 2 ainda está marcado
    revertStillDue: false,   // e não deve mais nada
    revertKids: [5],         // tinha re-parenteado o 5
  };
  const out = await runResellerDelinquencyCron(new Date(2026, 7, 20));
  assert.equal(out.resellerReverted, 1);
  assert.deepEqual(cap.restore[0], [5], 'sub-parceiro 5 volta pro pai original');
  assert.deepEqual(cap.clear[0], [2], 'parceiro 2 volta a active');
});
