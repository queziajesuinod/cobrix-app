const express = require('express');
const { query } = require('../db');
const { requireAuth, companyScope } = require('./auth');
const { runDaily } = require('../jobs/billing-cron');
const { sendWhatsapp } = require('../services/messenger');
const { msgPre, msgDue, msgLate } = require('../services/message-templates');
const { ensureGatewayPaymentLink } = require('../services/payment-gateway');
const { notifyBillingPaid } = require('../services/payment-notifications');
const { isGatewayConfigured } = require('../services/company-gateway');
const { ensureDateOnly, formatISODate } = require('../utils/date-only');
const { normalizeBillingIntervalMonths, isBillingMonthFor } = require('../jobs/billing-cron');

const router = express.Router();
const SCHEMA = process.env.DB_SCHEMA || 'public';

function validStatus(s) { return ['pending', 'paid', 'canceled'].includes(String(s || '').toLowerCase()); }
function isoDate(value) { return formatISODate(value); }
function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  return { y, m, start: isoDate(start), end: isoDate(end) };
}

function summarizeGatewayPayment(gatewayPayment) {
  if (!gatewayPayment) return null;
  return {
    txid: gatewayPayment.txid || null,
    paymentUrl: gatewayPayment.paymentUrl || null,
    copyPaste: gatewayPayment.copyPaste || null,
    expiresAtIso: gatewayPayment.expiresAtIso || null,
  };
}

function encodeProviderResponse(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

async function setContractMonthStatusPaid(contractId, companyId, billingDate) {
  if (!contractId || !companyId || !billingDate) return;
  const date = ensureDateOnly(billingDate);
  if (!date) return;
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  await query(
    `INSERT INTO ${SCHEMA}.contract_month_status (contract_id, company_id, year, month, status)
     VALUES ($1,$2,$3,$4,'paid')
     ON CONFLICT (contract_id, year, month)
     DO UPDATE SET status='paid', updated_at=NOW()`,
    [Number(contractId), Number(companyId), year, month]
  ).catch(() => {});
}

async function ensureContractMonthStatusPending(contractId, companyId, billingDate) {
  if (!contractId || !companyId || !billingDate) return;
  const date = ensureDateOnly(billingDate);
  if (!date) return;
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  await query(
    `INSERT INTO ${SCHEMA}.contract_month_status (contract_id, company_id, year, month, status)
     VALUES ($1,$2,$3,$4,'pending')
     ON CONFLICT (contract_id, year, month) DO NOTHING`,
    [Number(contractId), Number(companyId), year, month]
  ).catch(() => {});
}

function computeCustomAmount(entry, contractValue) {
  const amount = entry?.amount != null ? Number(entry.amount) : null;
  const perc = entry?.percentage != null ? Number(entry.percentage) : null;
  if (amount != null && !Number.isNaN(amount) && amount > 0) return Number(amount);
  if (perc != null && !Number.isNaN(perc) && perc > 0) {
    const base = Number(contractValue || 0);
    return Number(((base * perc) / 100).toFixed(2));
  }
  return null;
}

function isIntervalDayFor(contract, dateValue) {
  const target = ensureDateOnly(dateValue);
  const start = ensureDateOnly(contract?.start_date);
  const interval = Number(contract?.billing_interval_days || 0);
  if (!target || !start || interval <= 0) return false;
  const diff = Math.floor((target - start) / (1000 * 60 * 60 * 24));
  if (diff < 0) return false;
  return diff % interval === 0;
}

// helper para inserir na billing_notifications (todas colunas)
async function insertBillingNotification({
  companyId,
  billingId = null,
  contractId = null,
  clientId = null,
  kind = 'manual',               // 'manual' ou 'auto'
  targetDate,                    // 'YYYY-MM-DD'
  status = 'queued',             // 'queued' | 'sent' | 'failed' | 'skipped'
  provider = 'evo',
  toNumber = null,
  message = '',
  providerStatus = null,
  providerResponse = null,       // objeto -> jsonb
  error = null,
  sentAt = null,                 // Date | null
  type,                          // 'pre' | 'due' | 'late' | 'manual'
  dueDate                        // 'YYYY-MM-DD'
}) {
  const sql = `
    INSERT INTO ${SCHEMA}.billing_notifications
      (company_id, billing_id, contract_id, client_id, kind, target_date,
       status, provider, to_number, message, provider_status, provider_response,
       error, created_at, sent_at, type, due_date)
    VALUES
      ($1,$2,$3,$4,$5,$6,
       $7,$8,$9,$10,$11,$12,
       $13, NOW(), $14, $15, $16)
    RETURNING id
  `;
  const serializedProviderResponse = encodeProviderResponse(providerResponse);
  const params = [
    Number(companyId),
    billingId != null ? Number(billingId) : null,
    contractId != null ? Number(contractId) : null,
    clientId != null ? Number(clientId) : null,
    String(kind),
    String(targetDate),
    String(status),
    String(provider),
    toNumber != null ? String(toNumber) : null,
    message != null ? String(message) : '',
    providerStatus != null ? String(providerStatus) : null,
    serializedProviderResponse,
    error != null ? String(error) : null,
    sentAt ?? null,
    String(type),
    String(dueDate),
  ];
  const r = await query(sql, params);
  return r.rows[0].id;
}

// LIST com filtros
router.get('/', requireAuth, companyScope(true), async (req, res) => {
  try {
    const { ym, clientId, contractId, status } = req.query;
    let cond = ['c.company_id = $1'];
    const params = [req.companyId];

    if (ym && /^\d{4}-\d{2}$/.test(ym)) {
      const { start, end } = monthBounds(ym);
      params.push(start, end);
      cond.push('b.billing_date >= $2 AND b.billing_date < $3');
    }
    if (clientId) { params.push(Number(clientId)); cond.push(`cl.id = $${params.length}`); }
    if (contractId) { params.push(Number(contractId)); cond.push(`c.id = $${params.length}`); }
    if (status && validStatus(status)) { params.push(String(status)); cond.push(`b.status = $${params.length}`); }

    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const r = await query(`
      SELECT b.*, c.description AS contract_description, cl.name AS client_name
      FROM ${SCHEMA}.billings b
      JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
      JOIN ${SCHEMA}.clients   cl ON cl.id = c.client_id
      ${where}
      ORDER BY b.billing_date DESC, b.id DESC
    `, params);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// KPIs do m├¬s
router.get('/kpis', requireAuth, companyScope(true), async (req, res) => {
  try {
    const { ym, clientId, contractId } = req.query;
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: 'ym (YYYY-MM) obrigatório' });
    const { y, m, start, end } = monthBounds(ym);

    let condC = ['c.company_id = $1', 'c.active = true', 'c.start_date <= $2', 'c.end_date >= $3', '(c.cancellation_date IS NULL OR c.cancellation_date >= $3)'];
    let pC = [req.companyId, end, start];
    if (clientId) { pC.push(Number(clientId)); condC.push(`cl.id = $${pC.length}`); }
    if (contractId) { pC.push(Number(contractId)); condC.push(`c.id = $${pC.length}`); }

    const active = await query(`
      SELECT c.id
      FROM ${SCHEMA}.contracts c JOIN ${SCHEMA}.clients cl ON cl.id = c.client_id
      WHERE ${condC.join(' AND ')}
    `, pC);

    const activeIds = active.rows.map(r => r.id);
    const idsSql = activeIds.length ? `AND b.contract_id = ANY($4::int[])` : '';
    const pB = [req.companyId, start, end];
    if (activeIds.length) pB.push(activeIds);

    const bills = await query(`
      SELECT LOWER(b.status) AS status, COUNT(*)::int AS cnt
      FROM ${SCHEMA}.billings b
      JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
      WHERE c.company_id = $1
        AND c.active = true
        AND b.billing_date >= $2 AND b.billing_date < $3
        ${idsSql}
      GROUP BY LOWER(b.status)
    `, pB);

    const cms = await query(`
      SELECT LOWER(cms.status) AS status, COUNT(*)::int AS cnt
      FROM ${SCHEMA}.contract_month_status cms
      JOIN ${SCHEMA}.contracts c ON c.id = cms.contract_id
      WHERE cms.company_id = $1
        AND c.company_id = $1
        AND c.active = true
        AND cms.year = $2
        AND cms.month = $3
      GROUP BY LOWER(cms.status)
    `, [req.companyId, y, m]);

    const k = {
      contractsActive: activeIds.length,
      monthsPaid: 0, monthsPending: 0, monthsCanceled: 0,
      contractsPaid: 0, contractsPending: 0, contractsCanceled: 0,
      billingsPaid: 0, billingsPending: 0, billingsCanceled: 0, billingsTotal: 0,
    };
    for (const r of cms.rows) {
      const status = String(r.status || '').trim().toLowerCase();
      if (status === 'paid') { k.monthsPaid += r.cnt; k.contractsPaid += r.cnt; }
      else if (status === 'canceled') { k.monthsCanceled += r.cnt; k.contractsCanceled += r.cnt; }
      else { k.monthsPending += r.cnt; k.contractsPending += r.cnt; }
    }
    const recordedContracts = k.contractsPaid + k.contractsPending + k.contractsCanceled;
    if (recordedContracts < k.contractsActive) {
      k.contractsPending += (k.contractsActive - recordedContracts);
    }
    for (const r of bills.rows) {
      const status = String(r.status || '').trim().toLowerCase();
      if (status === 'paid') k.billingsPaid += r.cnt;
      else if (status === 'canceled') k.billingsCanceled += r.cnt;
      else k.billingsPending += r.cnt;
      k.billingsTotal += r.cnt;
    }
    res.json(k);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Notifica├º├úo MANUAL (pre/due/late)
router.post('/notify', requireAuth, companyScope(true), async (req, res) => {
  try {
    const { contract_id, date, type } = req.body || {};
    const typ = String(type || '').toLowerCase();
    if (!['pre', 'due', 'late'].includes(typ)) return res.status(400).json({ error: 'type inválido' });
    if (!contract_id || !date) return res.status(400).json({ error: 'contract_id e date s├úo obrigatórios' });
    const gatewayReady = await isGatewayConfigured(req.companyId);

    const c = await query(`
      SELECT c.*, cl.name AS client_name, cl.phone AS client_phone, cl.responsavel AS client_responsavel, cl.email AS client_email,
             cl.document_cpf AS client_document_cpf, cl.document_cnpj AS client_document_cnpj
      FROM ${SCHEMA}.contracts c
      JOIN ${SCHEMA}.clients   cl ON cl.id = c.client_id
      WHERE c.id = $1 AND c.company_id = $2
    `, [contract_id, req.companyId]);
    const row = c.rows[0];
    if (!row) return res.status(404).json({ error: 'Contrato n├úo encontrado' });

    const mode = String(row.billing_mode || 'monthly').toLowerCase();
    let due = ensureDateOnly(date);
    if (!due && mode === 'monthly') {
      const baseDate = new Date();
      due = dueDateForMonth(baseDate, row.billing_day || 1);
    }
    if (!due) return res.status(400).json({ error: 'date inv?lida' });
    const dueStr = isoDate(due);

    let amount = Number(row.value || 0);
    if (mode === 'custom_dates') {
      const cb = await query(
        `SELECT amount, percentage FROM ${SCHEMA}.contract_custom_billings WHERE contract_id=$1 AND billing_date=$2`,
        [contract_id, dueStr]
      );
      const entry = cb.rows[0];
      if (!entry) return res.status(400).json({ error: 'Data n?o cadastrada nas parcelas customizadas' });
      const computed = computeCustomAmount(entry, row.value);
      if (!computed || computed <= 0) return res.status(400).json({ error: 'Parcela customizada sem valor calculado' });
      amount = computed;
    } else if (mode === 'interval_days') {
      if (!isIntervalDayFor(row, due)) {
        return res.status(409).json({ error: 'Data fora do intervalo de dias do contrato' });
      }
    } else if (!isBillingMonthFor(row, due)) {
      return res.status(409).json({ error: 'Contrato fora da periodicidade de cobran?a para este m?s' });
    }
    

    // se m├¬s j├í pago/cancelado, bloqueia
    const cms = await query(`
      SELECT status FROM ${SCHEMA}.contract_month_status
      WHERE contract_id=$1 AND year=$2 AND month=$3
    `, [contract_id, due.getFullYear(), due.getMonth() + 1]);
    if (cms.rows[0] && (cms.rows[0].status === 'paid' || cms.rows[0].status === 'canceled')) {
      return res.status(409).json({ error: 'Mês já está PAGO/CANCELADO — notificação bloqueada' });
    }

    // se for due/late, n├úo envia se j├í houver billing pago/cancelado
    if (typ !== 'pre') {
      const b = await query(`
        SELECT 1 FROM ${SCHEMA}.billings
        WHERE contract_id=$1 AND billing_date=$2 AND status IN ('paid','canceled') LIMIT 1
      `, [contract_id, dueStr]);
      if (b.rowCount) return res.status(409).json({ error: 'Cobrança já está PAGA/CANCELADA — notificação bloqueada' });
    }

    // usa advisory lock por contrato para evitar race conditions
    await query('SELECT pg_advisory_lock($1)', [Number(contract_id)]);
    try {
      // checa exist├¬ncia novamente dentro da lock
      const exists2 = await query(`
        SELECT 1 FROM ${SCHEMA}.billing_notifications
        WHERE contract_id=$1 AND due_date=$2 AND type=$3 LIMIT 1
      `, [contract_id, dueStr, typ]);
      if (exists2.rowCount) {
        return res.status(409).json({ error: 'Notificação já enviada para esse tipo/data' });
      }

      if (!row.client_phone) return res.status(400).json({ error: 'Contrato sem telefone do cliente' });

      const mesRefDate = new Date(due.getFullYear(), due.getMonth(), 1);
      const billingLookup = await query(`
        SELECT id FROM ${SCHEMA}.billings
        WHERE company_id=$1 AND contract_id=$2 AND billing_date=$3
        LIMIT 1
      `, [req.companyId, Number(contract_id), dueStr]);
      let billingId = billingLookup.rows[0]?.id || null;
      let createdBilling = false;
      if (!billingId) {
        const inserted = await query(`
          INSERT INTO ${SCHEMA}.billings (company_id, contract_id, billing_date, amount, status)
          VALUES ($1,$2,$3,$4,'pending')
          ON CONFLICT (contract_id, billing_date)
          DO UPDATE SET amount = EXCLUDED.amount
          RETURNING id
        `, [req.companyId, Number(contract_id), dueStr, amount]);
        billingId = inserted.rows[0]?.id || billingId;
        createdBilling = Boolean(billingId);
      }
      if (createdBilling) {
        await ensureContractMonthStatusPending(contract_id, req.companyId, dueStr);
      }
      const map = { pre: msgPre, due: msgDue, late: msgLate };
      const recipientName = row.client_responsavel || row.client_name;
      const clientDocument = {
        cpf: row.client_document_cpf || null,
        cnpj: row.client_document_cnpj || null,
      };
      const gatewayPayment = gatewayReady ? await ensureGatewayPaymentLink({
        companyId: req.companyId,
        contractId: Number(contract_id),
        billingId,
        dueDate: dueStr,
        amount,
        contractDescription: row.description,
        clientName: recipientName,
        clientDocument,
      }) : null;
      const gatewaySummary = summarizeGatewayPayment(gatewayPayment);
      const copyPaste = gatewaySummary?.copyPaste || null;
      const text = await map[typ]({
        nome: recipientName,
        responsavel: row.client_responsavel,
        client_name: row.client_name,
        tipoContrato: row.description,
        mesRefDate,
        vencimentoDate: due,
        valor: amount,
        companyId: req.companyId,
        gatewayPayment,
        gatewayPaymentLink: Boolean(copyPaste),
        payment_link: null,
        payment_code: copyPaste,
        payment_qrcode: null,
        payment_expires_at_iso: gatewaySummary?.expiresAtIso || null,
      });

      // envia via EVO com config da empresa
      const evo = await sendWhatsapp(req.companyId, { number: row.client_phone, text });

      // registra completo
      const providerResponse = {
        messenger: evo.data ?? null,
        messengerStatus: evo.status ?? null,
        gateway: gatewaySummary,
      };

      await insertBillingNotification({
        companyId: req.companyId,
        billingId,
        contractId: Number(contract_id),
        clientId: Number(row.client_id),
        kind: 'manual',
        targetDate: isoDate(new Date()),
        status: evo.ok ? 'sent' : 'failed',
        provider: 'evo',
        toNumber: row.client_phone,
        message: text,
        providerStatus: evo.status != null ? String(evo.status) : null,
        providerResponse,
        error: evo.ok ? null : (evo.error || null),
        sentAt: evo.ok ? new Date() : null,
        type: typ,
        dueDate: dueStr,
      });

      res.json({ ok: true, provider: { ok: evo.ok, status: evo.status, data: evo.data } });
    } finally {
      // libera sempre o advisory lock
      try {
        await query('SELECT pg_advisory_unlock($1)', [Number(contract_id)]);
      } catch (unlockErr) {
        console.warn('unlock failed', unlockErr);
      }
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Atualiza status da cobrança
router.put('/:id/status', requireAuth, companyScope(true), async (req, res) => {
  const status = String(req.body?.status || '').toLowerCase();
  if (!validStatus(status)) return res.status(400).json({ error: 'status inválido' });
  const billingId = Number(req.params.id);
  if (!billingId) return res.status(400).json({ error: 'cobrança inválida' });
  try {
    const existing = await query(
      `
      SELECT b.id, b.status, b.amount, b.contract_id, b.billing_date
      FROM ${SCHEMA}.billings b
      JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
      WHERE b.id = $1 AND c.company_id = $2
    `, [billingId, req.companyId]);
    const row = existing.rows[0];
    if (!row) return res.status(404).json({ error: 'Cobrança não encontrada' });
    const previousStatus = String(row.status || '').toLowerCase();

    const updated = await query(
      `
      UPDATE ${SCHEMA}.billings b
      SET status=$1,
          updated_at=NOW(),
          gateway_paid_at = CASE
            WHEN $1 = 'paid' THEN COALESCE(gateway_paid_at, NOW())
            ELSE gateway_paid_at
          END
      FROM ${SCHEMA}.contracts c
      WHERE b.id=$2 AND c.id=b.contract_id AND c.company_id=$3
      RETURNING b.id, b.status
    `, [status, billingId, req.companyId]);
    if (!updated.rows[0]) return res.status(404).json({ error: 'Cobrança não encontrada' });

    if (status === 'paid' && previousStatus !== 'paid') {
      try {
        await setContractMonthStatusPaid(row.contract_id, req.companyId, row.billing_date);
      } catch (cmsErr) {
        console.error('[billing-status] falha ao atualizar contract_month_status billing=%s err=%s', billingId, cmsErr.message);
      }
      try {
        await notifyBillingPaid({
          billingId,
          companyId: req.companyId,
          amount: row.amount,
          paymentDate: new Date(),
          detail: { source: 'manual-status', status: 'CONCLUIDA' },
        });
      } catch (notifyErr) {
        console.error('[billing-status] falha ao notificar pagamento manual billing=%s err=%s', billingId, notifyErr.message);
      }
    }

    res.json(updated.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// Hist├│rico de notifica├º├Áes de uma cobran├ºa
router.get('/:id/notifications', requireAuth, companyScope(true), async (req, res) => {
  try {
    const b = await query(`
      SELECT b.contract_id, b.billing_date, c.company_id
      FROM ${SCHEMA}.billings b
      JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
      WHERE b.id = $1
    `, [req.params.id]);
    const row = b.rows[0];
    if (!row || Number(row.company_id) !== Number(req.companyId)) {
      return res.status(404).json({ error: 'Cobrança não encontrada' });
    }

    const n = await query(`
      SELECT type, sent_at
      FROM ${SCHEMA}.billing_notifications
      WHERE contract_id = $1 AND due_date = $2
      ORDER BY sent_at ASC
    `, [row.contract_id, row.billing_date]);
    res.json(n.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Marca status do m├¬s por contrato (sincroniza billings do m├¬s)
router.put('/by-contract/:contractId/month/:year/:month/status', requireAuth, companyScope(true), async (req, res) => {
  const contractId = Number(req.params.contractId);
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  const status = String(req.body?.status || '').toLowerCase();
  if (!validStatus(status)) return res.status(400).json({ error: 'status inválido' });
  if (!contractId || !year || !month) return res.status(400).json({ error: 'parâmetros inválidos' });

  try {
    const c = await query(`SELECT id FROM ${SCHEMA}.contracts WHERE id=$1 AND company_id=$2`, [contractId, req.companyId]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Contrato não encontrado' });

    await query(`
      INSERT INTO ${SCHEMA}.contract_month_status (contract_id, company_id, year, month, status)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (contract_id, year, month)
      DO UPDATE SET status=EXCLUDED.status, updated_at=now()
    `, [contractId, req.companyId, year, month, status]);

    const r = await query(`
      UPDATE ${SCHEMA}.billings b
      SET status = $1
      WHERE b.contract_id = $2
        AND EXTRACT(YEAR FROM b.billing_date) = $3
        AND EXTRACT(MONTH FROM b.billing_date) = $4
      RETURNING b.id
    `, [status, contractId, year, month]);

    res.json({ updated: r.rowCount, ids: r.rows.map(x => x.id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Vis├úo agrupada do m├¬s (para o front) ÔÇö somente contratos com month_status diferente de 'paid'
router.get('/overview', requireAuth, companyScope(true), async (req, res) => {
  const ym = String(req.query.ym || '').trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: 'Parametro ym (YYYY-MM) obrigatório' });
  const [year, month] = ym.split('-').map(Number);
  const clientIdRaw = req.query.clientId;
  const contractIdRaw = req.query.contractId;
  const dueDayRaw = req.query.dueDay;
  const clientId = clientIdRaw ? Number(clientIdRaw) : null;
  const contractId = contractIdRaw ? Number(contractIdRaw) : null;
  const dueDay = dueDayRaw !== undefined && dueDayRaw !== null && String(dueDayRaw).trim() !== ''
    ? Number(dueDayRaw)
    : null;
  if (clientIdRaw && (clientId == null || Number.isNaN(clientId))) return res.status(400).json({ error: 'clientId inválido' });
  if (contractIdRaw && (contractId == null || Number.isNaN(contractId))) return res.status(400).json({ error: 'contractId inválido' });
  if (dueDayRaw && (dueDay == null || Number.isNaN(dueDay) || dueDay < 1 || dueDay > 31)) {
    return res.status(400).json({ error: 'dueDay inválido' });
  }
  try {
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1); // primeiro dia do mÇ¦s seguinte
    const monthStartIso = isoDate(monthStart);
    const monthEndIso = isoDate(monthEnd);
    const notif = await query(`
      SELECT bn.contract_id, bn.type, COUNT(*) AS cnt, MAX(bn.sent_at) AS last_sent_at,
             c.client_id, c.description AS contract_description, cl.name AS client_name,
             MAX(c.cancellation_date) AS cancellation_date,
             MAX(c.billing_day) AS billing_day
      FROM ${SCHEMA}.billing_notifications bn
      JOIN ${SCHEMA}.contracts c ON c.id = bn.contract_id
      JOIN ${SCHEMA}.clients cl ON cl.id = c.client_id
      WHERE c.company_id = $1
        AND c.active = true
        AND EXTRACT(YEAR FROM bn.due_date) = $2
        AND EXTRACT(MONTH FROM bn.due_date) = $3
        AND ($4::int IS NULL OR c.client_id = $4)
        AND ($5::int IS NULL OR c.id = $5)
        AND ($6::int IS NULL OR EXTRACT(DAY FROM bn.due_date) = $6)
        AND (c.cancellation_date IS NULL OR c.cancellation_date >= $7::date)
        AND c.start_date <= $8::date
        AND c.end_date >= $7::date
        AND NOT EXISTS (
          SELECT 1 FROM ${SCHEMA}.contract_month_status cms2
          WHERE cms2.contract_id = bn.contract_id AND cms2.year = $2 AND cms2.month = $3 AND cms2.status = 'paid'
        )
      GROUP BY bn.contract_id, bn.type, c.client_id, c.description, cl.name
    `, [req.companyId, year, month, clientId, contractId, dueDay, monthStartIso, monthEndIso]);

    const cms = await query(`
      SELECT cms.contract_id, cms.status, c.client_id, c.description AS contract_description,
             cl.name AS client_name, c.cancellation_date, c.billing_day
      FROM ${SCHEMA}.contract_month_status cms
      JOIN ${SCHEMA}.contracts c ON c.id = cms.contract_id
      JOIN ${SCHEMA}.clients cl ON cl.id = c.client_id
      WHERE cms.company_id = $1 AND cms.year = $2 AND cms.month = $3
        AND cms.status <> 'paid'
        AND c.active = true
        AND ($4::int IS NULL OR c.client_id = $4)
        AND ($5::int IS NULL OR c.id = $5)
        AND (c.cancellation_date IS NULL OR c.cancellation_date >= $6::date)
        AND c.start_date <= $7::date
        AND c.end_date >= $6::date
    `, [req.companyId, year, month, clientId, contractId, monthStartIso, monthEndIso]);

    const bills = await query(`
      SELECT b.*, c.description AS contract_description, c.client_id AS contract_client_id,
             cl.name AS client_name, c.cancellation_date, c.billing_day
      FROM ${SCHEMA}.billings b
      JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
      JOIN ${SCHEMA}.clients   cl ON cl.id = c.client_id
      WHERE c.company_id = $1
        AND c.active = true
        AND EXTRACT(YEAR FROM b.billing_date) = $2
        AND EXTRACT(MONTH FROM b.billing_date) = $3
        AND ($4::int IS NULL OR cl.id = $4)
        AND ($5::int IS NULL OR c.id = $5)
        AND ($6::int IS NULL OR EXTRACT(DAY FROM b.billing_date) = $6)
        AND (c.cancellation_date IS NULL OR c.cancellation_date >= $7::date)
        AND c.start_date <= $8::date
        AND c.end_date >= $7::date
        AND NOT EXISTS (
          SELECT 1 FROM ${SCHEMA}.contract_month_status cms2
          WHERE cms2.contract_id = c.id AND cms2.year = $2 AND cms2.month = $3 AND cms2.status = 'paid'
        )
      ORDER BY b.billing_date ASC, b.id ASC
    `, [req.companyId, year, month, clientId, contractId, dueDay, monthStartIso, monthEndIso]);

    const byContract = {};
    for (const r of bills.rows) {
      const key = r.contract_id;
      const entry = byContract[key] ?? {
        contract_id: key,
        contract_description: null,
        client_name: null,
        client_id: null,
        month_status: 'pending',
        notifications: {},
        billings: [],
        cancellation_date: null,
        billing_day: null,
      };
      entry.contract_description ??= r.contract_description;
      entry.client_name ??= r.client_name;
      entry.client_id ??= r.contract_client_id != null ? Number(r.contract_client_id) : entry.client_id;
      entry.cancellation_date ??= r.cancellation_date ?? entry.cancellation_date;
      entry.billings.push(r);
      if (r.billing_day != null) entry.billing_day ??= Number(r.billing_day);
      byContract[key] = entry;
    }
    for (const n of notif.rows) {
      const key = n.contract_id;
      const entry = byContract[key] ?? { contract_id: key, contract_description: null, client_name: null, client_id: null, month_status: 'pending', notifications: {}, billings: [], cancellation_date: null, billing_day: null };
      entry.contract_description ??= n.contract_description || entry.contract_description;
      entry.client_name ??= n.client_name || entry.client_name;
      entry.client_id ??= n.client_id != null ? Number(n.client_id) : entry.client_id;
      entry.cancellation_date ??= n.cancellation_date ?? entry.cancellation_date;
      if (n.billing_day != null) entry.billing_day ??= Number(n.billing_day);
      entry.notifications[n.type] = { count: Number(n.cnt), last_sent_at: n.last_sent_at };
      byContract[key] = entry;
    }
    for (const s of cms.rows) {
      if (dueDay != null && !byContract[s.contract_id]) continue;
      const key = s.contract_id;
      const entry = byContract[key] ?? { contract_id: key, contract_description: null, client_name: null, client_id: null, month_status: 'pending', notifications: {}, billings: [], cancellation_date: null, billing_day: null };
      entry.month_status = s.status;
      entry.contract_description ??= s.contract_description || entry.contract_description;
      entry.client_name ??= s.client_name || entry.client_name;
      entry.client_id ??= s.client_id != null ? Number(s.client_id) : entry.client_id;
      entry.cancellation_date ??= s.cancellation_date ?? entry.cancellation_date;
      if (s.billing_day != null) entry.billing_day ??= Number(s.billing_day);
      byContract[key] = entry;
    }
    const result = Object.values(byContract).map(item => {
      if (item.cancellation_date) {
        const cancel = new Date(item.cancellation_date);
        const cancelKey = cancel.getFullYear() * 100 + (cancel.getMonth() + 1);
        const currentKey = year * 100 + month;
        if (currentKey > cancelKey) {
          item.month_status = 'canceled';
        }
      }
      return item;
    }).sort((a, b) => {
      const dayA = Number.isFinite(a.billing_day) ? a.billing_day : 999;
      const dayB = Number.isFinite(b.billing_day) ? b.billing_day : 999;
      if (dayA !== dayB) return dayA - dayB;
      return (a.contract_id || 0) - (b.contract_id || 0);
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Lista contratos marcados como PAGO em um m├¬s
router.get('/paid', requireAuth, companyScope(true), async (req, res) => {
  const ym = String(req.query.ym || '').trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: 'Par├ómetro ym (YYYY-MM) obrigatório' });
  const [year, month] = ym.split('-').map(Number);
  const clientIdRaw = req.query.clientId;
  const contractIdRaw = req.query.contractId;
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 20, 1), 200);
  const clientId = clientIdRaw ? Number(clientIdRaw) : null;
  const contractId = contractIdRaw ? Number(contractIdRaw) : null;
  if (clientIdRaw && (clientId == null || Number.isNaN(clientId))) return res.status(400).json({ error: 'clientId inválido' });
  if (contractIdRaw && (contractId == null || Number.isNaN(contractId))) return res.status(400).json({ error: 'contractId inválido' });
  const offset = (page - 1) * pageSize;
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  const monthStartIso = isoDate(monthStart);
  const monthEndIso = isoDate(monthEnd);

  try {
    const count = await query(`
      SELECT COUNT(*)::int AS total
      FROM ${SCHEMA}.contract_month_status cms
      JOIN ${SCHEMA}.contracts c ON c.id = cms.contract_id
      JOIN ${SCHEMA}.clients cl ON cl.id = c.client_id
      WHERE cms.company_id = $1
        AND LOWER(cms.status) = 'paid'
        AND cms.year = $2
        AND cms.month = $3
        AND ($4::int IS NULL OR cl.id = $4)
        AND ($5::int IS NULL OR c.id = $5)
        AND (c.cancellation_date IS NULL OR c.cancellation_date >= $6::date)
        AND c.start_date <= $7::date
        AND c.end_date >= $6::date
    `, [req.companyId, year, month, clientId, contractId, monthStartIso, monthEndIso]);

    const rows = await query(`
      SELECT cms.contract_id,
             cms.year,
             cms.month,
             cms.status,
             cms.updated_at,
             c.description AS contract_description,
             c.value AS contract_value,
             c.billing_day,
             cl.id AS client_id,
             cl.name AS client_name
      FROM ${SCHEMA}.contract_month_status cms
      JOIN ${SCHEMA}.contracts c ON c.id = cms.contract_id
      JOIN ${SCHEMA}.clients cl ON cl.id = c.client_id
      WHERE cms.company_id = $1
        AND LOWER(cms.status) = 'paid'
        AND cms.year = $2
        AND cms.month = $3
        AND ($4::int IS NULL OR cl.id = $4)
        AND ($5::int IS NULL OR c.id = $5)
        AND (c.cancellation_date IS NULL OR c.cancellation_date >= $6::date)
        AND c.start_date <= $7::date
        AND c.end_date >= $6::date
      ORDER BY cms.updated_at DESC NULLS LAST, c.description ASC
      LIMIT $8 OFFSET $9
    `, [req.companyId, year, month, clientId, contractId, monthStartIso, monthEndIso, pageSize, offset]);

    res.json({
      page,
      pageSize,
      total: count.rows[0]?.total ?? 0,
      data: rows.rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Rodar pipeline (manual)
router.post('/check/run', requireAuth, companyScope(true), async (req, res) => {
  try {
    let { date, generate = true, pre = true, due = true, late = true } = (req.body || {});
    const base = ensureDateOnly(date);
    if (!base) return res.status(400).json({ error: 'date (YYYY-MM-DD) obrigatório' });
    await runDaily(base, { generate, pre, due, late, companyId: req.companyId });
    res.json({ ok: true, ran_for: base.toISOString().slice(0, 10), steps: { generate, pre, due, late } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
