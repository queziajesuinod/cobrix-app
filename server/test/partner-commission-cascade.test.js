// Testa a liquidação em CASCATA de accrueForPaidBilling sem banco: injeta um mock
// de ../db no require.cache ANTES de carregar o serviço (o serviço faz
// `const { query } = require('../db')` no load, então o mock precisa estar no lugar
// antes do primeiro require). O mock lê de `scenario`, ajustado por cada teste.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const PADRAO = 1;
let scenario = null;   // { plan, sub, chainStart, ancestors: {id: row} }
let inserts = [];
let seq = 0;

function fakeQuery(sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ');
  if (s.includes("SET status='settled'") && s.includes('charge_billing_id')) return { rows: [], rowCount: 0 };
  if (s.includes('company_subscriptions') && s.includes('owner_company_id') && s.includes('contract_id')) {
    return { rows: [scenario.sub] };
  }
  if (s.includes('FROM') && s.includes('plans') && s.includes('partner_commission_type')) {
    return { rows: [scenario.plan] };
  }
  if (s.includes('is_saas_owner')) return { rows: [{ id: PADRAO }] };
  if (s.includes('SELECT parent_partner_id FROM')) return { rows: [{ parent_partner_id: scenario.chainStart }] };
  if (s.includes('is_partner, partner_override_type')) {
    const row = scenario.ancestors[Number(params[0])];
    return { rows: row ? [row] : [] };
  }
  if (s.includes('permission_keys')) return { rows: [{ name: 'c' + params[0], plan_id: 99, permission_keys: [] }] };
  if (s.includes('INSERT INTO') && s.includes('partner_commissions')) {
    inserts.push(params);
    return { rows: [{ id: ++seq }] };
  }
  throw new Error('Query não mapeada no mock: ' + s.slice(0, 120));
}

const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: fakeQuery } };
const { accrueForPaidBilling } = require('../src/services/partner-commission');

// params: [subId, billingId, contractId, payer, payee, kind, period, floor, rate_type, rate_value, amount, kept, reparent_target, parent_commission_id]
const P = (row) => ({ payer: row[3], payee: row[4], kind: row[5], amount: Number(row[10]), kept: Number(row[11]), reparent: row[12], parent: row[13] });

async function run(sc) {
  scenario = sc; inserts = []; seq = 0;
  const res = await accrueForPaidBilling({ billingId: 900, contractId: 800 });
  return { res, edges: inserts.map(P) };
}

test('cascata Padrão→Teifelt→X→Y: X→Teifelt=42, Teifelt→Padrão=30, encadeadas', async () => {
  const TEIFELT = 2, X = 3, Y = 4;
  const { res, edges } = await run({
    plan: { price_monthly: 60, price_annual: null, partner_commission_type: 'fixed', partner_commission_value: 30 },
    sub: { id: 50, company_id: Y, plan_id: 7, period: 'monthly', partner_id: X, owner_company_id: X },
    chainStart: TEIFELT,
    ancestors: { [TEIFELT]: { id: TEIFELT, parent_partner_id: null, is_partner: true, partner_override_type: 'fixed', partner_override_value: 12 } },
  });
  assert.equal(res.accrued, 2);
  assert.deepEqual(edges[0], { payer: X, payee: TEIFELT, kind: 'override', amount: 42, kept: 12, reparent: Y, parent: null });
  assert.deepEqual(edges[1], { payer: TEIFELT, payee: PADRAO, kind: 'base', amount: 30, kept: 30, reparent: X, parent: 1 });
});

test('parceiro direto da Padrão (sem intermediário): uma aresta só X→Padrão = base', async () => {
  const X = 3, Y = 4;
  const { res, edges } = await run({
    plan: { price_monthly: 100, price_annual: null, partner_commission_type: 'percent', partner_commission_value: 40 },
    sub: { id: 51, company_id: Y, plan_id: 7, period: 'monthly', partner_id: X, owner_company_id: X },
    chainStart: null, // X é direto da Padrão
    ancestors: {},
  });
  assert.equal(res.accrued, 1);
  assert.deepEqual(edges[0], { payer: X, payee: PADRAO, kind: 'base', amount: 40, kept: 40, reparent: Y, parent: null });
});

test('network_seized: parceiro tomado não retém override — redireciona à Padrão', async () => {
  // Teifelt seized (>6m): X ainda paga 42, mas Teifelt repassa TUDO; Padrão fica
  // com base 30 + override redirecionado 12 = 42.
  const TEIFELT = 2, X = 3, Y = 4;
  const { res, edges } = await run({
    plan: { price_monthly: 60, price_annual: null, partner_commission_type: 'fixed', partner_commission_value: 30 },
    sub: { id: 53, company_id: Y, plan_id: 7, period: 'monthly', partner_id: X, owner_company_id: X },
    chainStart: TEIFELT,
    ancestors: { [TEIFELT]: { id: TEIFELT, parent_partner_id: null, is_partner: true, partner_override_type: 'fixed', partner_override_value: 12, reseller_status: 'network_seized' } },
  });
  assert.equal(res.accrued, 2);
  assert.equal(edges[0].amount, 42, 'X→Teifelt segue 42');
  assert.equal(edges[0].kept, 0, 'Teifelt tomado não retém nada');
  assert.equal(edges[1].payee, PADRAO);
  assert.equal(edges[1].amount, 42, 'Padrão recebe base 30 + override tomado 12');
  assert.equal(edges[1].kept, 42);
});

test('trava dos 100%: override alto é limitado ao que sobra do piso', async () => {
  // piso 60, base 30 → sobra 30 p/ override; Teifelt pede 50 (fixed) → capado a 30.
  const TEIFELT = 2, X = 3, Y = 4;
  const { res, edges } = await run({
    plan: { price_monthly: 60, price_annual: null, partner_commission_type: 'fixed', partner_commission_value: 30 },
    sub: { id: 52, company_id: Y, plan_id: 7, period: 'monthly', partner_id: X, owner_company_id: X },
    chainStart: TEIFELT,
    ancestors: { [TEIFELT]: { id: TEIFELT, parent_partner_id: null, is_partner: true, partner_override_type: 'fixed', partner_override_value: 50 } },
  });
  assert.equal(res.accrued, 2);
  assert.equal(edges[0].amount, 60, 'pool = base 30 + override capado 30');
  assert.equal(edges[0].kept, 30, 'override do Teifelt capado a 30');
  assert.equal(edges[1].amount, 30, 'base intacta = 30');
});
