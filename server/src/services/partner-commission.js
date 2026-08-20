// server/src/services/partner-commission.js
// Comissão de revenda (ver memória partner-reseller-commission-model). A cada
// pagamento CONFIRMADO de uma assinatura vendida por parceiro, acumula no razão
// partner_commissions, de forma ADITIVA:
//   - base: comissão da Padrão (do plano, sobre o piso) — SEMPRE garantida.
//   - override: extra de cada ancestral (parceiro pai, avô…) na cadeia.
// Todas pagas pelo parceiro RECEBEDOR (owner_company_id da assinatura). Idempotente
// por (billing_id, payee): reprocessar o mesmo pagamento não duplica. Nunca lança —
// não pode quebrar a confirmação de pagamento.
const { query } = require('../db');
const { formatISODate } = require('../utils/date-only');
const { resolvePixPayment } = require('./pix-resolver');
const { sendWhatsapp } = require('./messenger');
const logger = require('../utils/logger');

const SCHEMA = process.env.DB_SCHEMA || 'public';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
const BRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Nome + se a empresa tem o Gerenciador Financeiro ativo (teto do plano inclui
// 'finance.*'; sem plano = acesso total = tem).
async function companyInfo(id) {
  const r = await query(
    `SELECT c.name, c.plan_id, p.permission_keys
       FROM ${SCHEMA}.companies c
       LEFT JOIN ${SCHEMA}.plans p ON p.id = c.plan_id
      WHERE c.id = $1`,
    [id]
  );
  const row = r.rows[0];
  if (!row) return { name: null, hasFinance: false };
  const hasFinance = row.plan_id == null
    || (Array.isArray(row.permission_keys) && row.permission_keys.some((k) => String(k).startsWith('finance.')));
  return { name: row.name, hasFinance };
}

// Lança a comissão no Gerenciador Financeiro: RECEITA para quem recebe (se tiver o
// módulo) e DESPESA 'a pagar' para quem paga (o parceiro), também só se tiver o
// módulo. Sem módulo, fica só no razão/tela. Best-effort — não quebra o acúmulo.
async function generateFinanceEntries({ commId, payer, payerInfo, payee, kind, amount, subscriptionId }) {
  try {
    const label = 'Comissão de revenda';
    const desc = `Comissão ${kind === 'base' ? 'base (plataforma)' : 'override (rede)'} — assinatura #${subscriptionId}`;
    const today = formatISODate(new Date());
    const payeeInfo = await companyInfo(payee);
    let revenueId = null;
    let expenseId = null;

    if (payeeInfo.hasFinance) {
      const rev = await query(
        `INSERT INTO ${SCHEMA}.finance_revenues (company_id, label, description, amount, received_at)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [payee, label, `${desc} — de ${payerInfo.name || ('empresa #' + payer)}`, amount, today]
      );
      revenueId = rev.rows[0]?.id || null;
    }
    if (payerInfo.hasFinance) {
      const exp = await query(
        `INSERT INTO ${SCHEMA}.finance_expenses
           (company_id, label, description, amount, paid_at, is_recurring, recurrence_active, expense_type, category, payee, status)
         VALUES ($1,$2,$3,$4,$5,false,false,'variable','Comissão de revenda',$6,'pending') RETURNING id`,
        [payer, label, desc, amount, today, payeeInfo.name || ('empresa #' + payee)]
      );
      expenseId = exp.rows[0]?.id || null;
    }
    if (revenueId || expenseId) {
      await query(
        `UPDATE ${SCHEMA}.partner_commissions SET finance_revenue_id=$1, finance_expense_id=$2 WHERE id=$3`,
        [revenueId, expenseId, commId]
      );
    }
  } catch (err) {
    logger.error({ err, commId }, '[commission] falha ao gerar lançamentos financeiros');
  }
}

// Valor de uma comissão sobre o piso: 'fixed' = valor em R$ (limitado ao piso);
// 'percent' = % do piso.
function commissionAmount(type, value, floor) {
  const v = Number(value) || 0;
  if (v <= 0) return 0;
  if (type === 'fixed') return round2(Math.min(v, floor));
  return round2((floor * v) / 100);
}

async function accrueForPaidBilling({ billingId = null, contractId }) {
  try {
    // Se este pagamento quita uma COBRANÇA DE COMISSÃO, dá baixa nas comissões
    // ligadas (settled) e encerra — não é uma assinatura para acumular.
    if (billingId) {
      const settled = await settleCommissionsByChargeBilling(billingId);
      if (settled.settled > 0) return { settledCharge: settled.settled };
    }
    if (!contractId) return { skipped: true, reason: 'sem-contrato' };

    // Assinatura ligada a este contrato (no tenant do recebedor).
    const subRes = await query(
      `SELECT id, plan_id, period, partner_id, owner_company_id
         FROM ${SCHEMA}.company_subscriptions
        WHERE contract_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [contractId]
    );
    const sub = subRes.rows[0];
    if (!sub) return { skipped: true, reason: 'sem-assinatura' };
    // Venda direta da Padrão (sem parceiro) → não há comissão a acumular.
    if (!sub.partner_id) return { skipped: true, reason: 'venda-direta' };

    const payer = sub.owner_company_id; // o parceiro recebedor paga todas as comissões

    const planRes = await query(
      `SELECT price_monthly, price_annual, partner_commission_type, partner_commission_value
         FROM ${SCHEMA}.plans WHERE id = $1`,
      [sub.plan_id]
    );
    const plan = planRes.rows[0];
    if (!plan) return { skipped: true, reason: 'sem-plano' };

    const per = sub.period === 'annual' ? 'annual' : 'monthly';
    const floorRate = per === 'annual' ? plan.price_annual : plan.price_monthly;
    if (floorRate == null) return { skipped: true, reason: 'sem-piso' };
    const floor = per === 'annual' ? Number(floorRate) * 12 : Number(floorRate);

    const commissions = [];

    // Base: comissão da Padrão (sempre garantida).
    const ownerRes = await query(`SELECT id FROM ${SCHEMA}.companies WHERE is_saas_owner = true LIMIT 1`);
    const padraoId = ownerRes.rows[0]?.id || null;
    if (padraoId) {
      const amount = commissionAmount(plan.partner_commission_type, plan.partner_commission_value, floor);
      if (amount > 0) {
        commissions.push({
          payee: padraoId, kind: 'base',
          rate_type: plan.partner_commission_type, rate_value: plan.partner_commission_value, amount,
        });
      }
    }

    // Overrides: sobe a cadeia de ancestrais (parceiro pai, avô…) até a raiz.
    const startRes = await query(`SELECT parent_partner_id FROM ${SCHEMA}.companies WHERE id = $1`, [sub.partner_id]);
    let ancestorId = startRes.rows[0]?.parent_partner_id || null;
    let guard = 0;
    while (ancestorId && guard++ < 50) {
      const a = await query(
        `SELECT id, parent_partner_id, is_partner, partner_override_type, partner_override_value
           FROM ${SCHEMA}.companies WHERE id = $1`,
        [ancestorId]
      );
      const arow = a.rows[0];
      if (!arow) break;
      if (arow.is_partner) {
        const amount = commissionAmount(arow.partner_override_type, arow.partner_override_value, floor);
        if (amount > 0) {
          commissions.push({
            payee: arow.id, kind: 'override',
            rate_type: arow.partner_override_type, rate_value: arow.partner_override_value, amount,
          });
        }
      }
      ancestorId = arow.parent_partner_id || null;
    }

    // TRAVA dos 100%: o total de comissões nunca passa de 100% do piso. A base da
    // Padrão é paga PRIMEIRO (sempre garantida); os overrides recebem só o que
    // sobrar, em ordem (parceiro pai mais próximo primeiro). Assim o parceiro nunca
    // deve mais do que o piso — vendendo ao piso, ele fica no zero, nunca negativo.
    let budget = floor;
    for (const c of commissions) {
      const capped = Math.min(Number(c.amount) || 0, Math.max(0, round2(budget)));
      c.amount = round2(capped);
      budget = round2(budget - c.amount);
    }
    const dueCommissions = commissions.filter((c) => c.amount > 0);

    const payerInfo = await companyInfo(payer);
    let inserted = 0;
    for (const c of dueCommissions) {
      if (c.payee === payer) continue; // nunca cobra do próprio recebedor
      const r = await query(
        `INSERT INTO ${SCHEMA}.partner_commissions
           (subscription_id, billing_id, contract_id, payer_company_id, payee_company_id, kind, period, floor_amount, rate_type, rate_value, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (billing_id, payee_company_id) WHERE billing_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [sub.id, billingId, contractId, payer, c.payee, c.kind, per, floor, c.rate_type, c.rate_value, c.amount]
      );
      const commId = r.rows[0]?.id;
      if (!commId) continue; // já existia (idempotência) → não relança no financeiro
      inserted += 1;
      // Interage com o Gerenciador Financeiro: receita (payee) + despesa a pagar (payer).
      await generateFinanceEntries({ commId, payer, payerInfo, payee: c.payee, kind: c.kind, amount: c.amount, subscriptionId: sub.id });
    }
    if (inserted) logger.info({ contractId, billingId, subscriptionId: sub.id, inserted }, '[commission] comissões acumuladas');
    return { accrued: inserted };
  } catch (err) {
    logger.error({ err, contractId, billingId }, '[commission] falha ao acumular comissão');
    return { error: true };
  }
}

// Contato do parceiro para cobrança: vem do registro de CLIENTE da assinatura do
// próprio parceiro (ele também é assinante). Fallback: só o nome da empresa.
async function resolvePartnerContact(partnerId) {
  const r = await query(
    `SELECT cl.name, cl.phone, cl.email, cl.document_cpf AS cpf, cl.document_cnpj AS cnpj
       FROM ${SCHEMA}.company_subscriptions cs
       JOIN ${SCHEMA}.clients cl ON cl.id = cs.client_id
      WHERE cs.company_id = $1 AND cs.client_id IS NOT NULL
      ORDER BY cs.created_at DESC LIMIT 1`,
    [partnerId]
  );
  if (r.rows[0]) return r.rows[0];
  const c = await query(`SELECT name FROM ${SCHEMA}.companies WHERE id=$1`, [partnerId]);
  return { name: c.rows[0]?.name || `Parceiro #${partnerId}`, phone: null, email: null, cpf: null, cnpj: null };
}

// Cliente + contrato de comissão (no tenant do CREDOR) que representam o parceiro.
// Reutilizados entre cobranças (find-or-create por nome/descrição). O contrato
// nasce INATIVO para o billing-cron não gerar mensalidades automáticas.
async function ensureCommissionClientContract(payeeCompanyId, contact) {
  const clientName = `${contact.name} (comissões)`;
  let cli = await query(`SELECT id FROM ${SCHEMA}.clients WHERE company_id=$1 AND name=$2 LIMIT 1`, [payeeCompanyId, clientName]);
  let clientId = cli.rows[0]?.id;
  if (!clientId) {
    const ins = await query(
      `INSERT INTO ${SCHEMA}.clients (company_id, name, email, phone, responsavel, document_cpf, document_cnpj)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [payeeCompanyId, clientName, contact.email, contact.phone, contact.name, contact.cpf, contact.cnpj]
    );
    clientId = ins.rows[0].id;
  }
  let ct = await query(`SELECT id FROM ${SCHEMA}.contract_types WHERE company_id=$1 ORDER BY is_recurring DESC, id ASC LIMIT 1`, [payeeCompanyId]);
  let ctId = ct.rows[0]?.id;
  if (!ctId) {
    const c = await query(`INSERT INTO ${SCHEMA}.contract_types (company_id, name, is_recurring, adjustment_percent) VALUES ($1,'Recorrente',true,0) RETURNING id`, [payeeCompanyId]);
    ctId = c.rows[0].id;
  }
  const description = `Comissões de revenda — ${contact.name}`;
  let con = await query(`SELECT id FROM ${SCHEMA}.contracts WHERE company_id=$1 AND client_id=$2 AND description=$3 LIMIT 1`, [payeeCompanyId, clientId, description]);
  let contractId = con.rows[0]?.id;
  if (!contractId) {
    const today = new Date();
    const todayIso = formatISODate(today);
    const endIso = formatISODate(new Date(today.getFullYear() + 10, today.getMonth(), today.getDate()));
    const ins = await query(
      `INSERT INTO ${SCHEMA}.contracts
         (company_id, client_id, contract_type_id, description, value, start_date, end_date, billing_day, billing_interval_months, billing_mode, active)
       VALUES ($1,$2,$3,$4,0,$5,$6,$7,1,'monthly',false) RETURNING id`,
      [payeeCompanyId, clientId, ctId, description, todayIso, endIso, today.getDate()]
    );
    contractId = ins.rows[0].id;
  }
  return { clientId, contractId, description };
}

// Gera a COBRANÇA da comissão de um parceiro (soma o que está 'accrued' para o
// credor atual): cria a billing no tenant do credor, gera PIX e manda WhatsApp com
// o contato do parceiro. As comissões passam a 'charged' e serão baixadas quando o
// pagamento confirmar (settleCommissionsByChargeBilling, no fluxo de pagamento).
async function chargePartnerCommissions({ payeeCompanyId, partnerId }) {
  const acc = await query(
    `SELECT id, amount FROM ${SCHEMA}.partner_commissions
      WHERE payee_company_id=$1 AND payer_company_id=$2 AND status='accrued'`,
    [payeeCompanyId, partnerId]
  );
  if (!acc.rows.length) { const e = new Error('Nenhuma comissão em aberto para cobrar deste parceiro'); e.status = 400; throw e; }
  const total = round2(acc.rows.reduce((a, r) => a + Number(r.amount), 0));
  const ids = acc.rows.map((r) => r.id);

  const contact = await resolvePartnerContact(partnerId);
  const { contractId } = await ensureCommissionClientContract(payeeCompanyId, contact);

  const todayIso = formatISODate(new Date());
  const bill = await query(
    `INSERT INTO ${SCHEMA}.billings (company_id, contract_id, billing_date, amount, status)
     VALUES ($1,$2,$3,$4,'pending')
     ON CONFLICT (contract_id, billing_date)
       DO UPDATE SET amount = ${SCHEMA}.billings.amount + EXCLUDED.amount, status='pending', updated_at=now()
     RETURNING id`,
    [payeeCompanyId, contractId, todayIso, total]
  );
  const billingId = bill.rows[0].id;
  await query(
    `UPDATE ${SCHEMA}.partner_commissions SET status='charged', charge_billing_id=$1 WHERE id = ANY($2::int[])`,
    [billingId, ids]
  );

  const pix = await resolvePixPayment({
    companyId: payeeCompanyId, contractId, billingId, amount: total, dueDate: todayIso,
    contractDescription: 'Comissão de revenda', clientName: contact.name,
    clientDocument: { cpf: contact.cpf, cnpj: contact.cnpj },
  });

  let whatsapp = false;
  if (contact.phone) {
    try {
      const linhas = [`Olá! Segue a cobrança da *comissão de revenda*: *${BRL(total)}*.`];
      if (pix?.copyPaste) { linhas.push('PIX copia e cola:'); linhas.push(pix.copyPaste); }
      await sendWhatsapp(payeeCompanyId, { number: contact.phone, text: linhas.join('\n') });
      whatsapp = true;
    } catch (err) {
      logger.warn({ err, partnerId }, '[commission-charge] envio de WhatsApp falhou');
    }
  }
  logger.info({ payeeCompanyId, partnerId, billingId, total, count: ids.length, whatsapp }, '[commission-charge] comissão cobrada');
  return { billingId, total, count: ids.length, pix: pix ? { copyPaste: pix.copyPaste || null, qrCodeImage: pix.qrCodeImage || null } : null, whatsapp, phone: contact.phone || null };
}

// Baixa as comissões ligadas a uma cobrança paga: 'settled' + quita a despesa do
// parceiro no financeiro (se existir). Idempotente.
async function settleCommissionsByChargeBilling(billingId) {
  if (!billingId) return { settled: 0 };
  const upd = await query(
    `UPDATE ${SCHEMA}.partner_commissions
        SET status='settled', settled_at=now()
      WHERE charge_billing_id=$1 AND status='charged'
      RETURNING finance_expense_id`,
    [billingId]
  );
  const expIds = upd.rows.map((r) => r.finance_expense_id).filter(Boolean);
  if (expIds.length) {
    await query(
      `UPDATE ${SCHEMA}.finance_expenses SET status='paid', updated_at=now()
        WHERE id = ANY($1::int[]) AND status <> 'paid'`,
      [expIds]
    );
  }
  return { settled: upd.rowCount };
}

module.exports = { accrueForPaidBilling, commissionAmount, chargePartnerCommissions, settleCommissionsByChargeBilling };
