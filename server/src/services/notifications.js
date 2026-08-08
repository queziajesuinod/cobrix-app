// server/src/services/notifications.js
// Notificações in-app (sino do topo). Geradas por empresa; leitura por usuário.
const { query } = require('../db');
const { formatISODate, addDays } = require('../utils/date-only');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const OVERDUE_DAYS = 60;

// Throttle do sync por empresa: o sino faz poll frequente, mas os alertas de
// "vence hoje"/"atraso +60d" só mudam ao longo do dia. Evita rodar os scans +
// upserts a cada poll. Cache em memória (por processo) do último sync.
const SYNC_THROTTLE_MS = Number(process.env.NOTIF_SYNC_THROTTLE_MS || 5 * 60 * 1000);
const lastSyncByCompany = new Map();

// Formata uma data (string ISO ou Date) para DD/MM/AAAA (pt-BR).
function formatBrDate(value) {
  const iso = formatISODate(value);
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Insere uma notificação (idempotente via dedup_key único por empresa).
// userId opcional: nulo = notificação da empresa; preenchido = pessoal.
async function createNotification({ companyId, type, title, body = null, refType = null, refId = null, link = null, dedupKey, userId = null }) {
  if (!companyId || !type || !title || !dedupKey) return null;
  const r = await query(
    `INSERT INTO ${SCHEMA}.notifications (company_id, user_id, type, title, body, ref_type, ref_id, link, dedup_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (company_id, dedup_key) DO NOTHING
     RETURNING id`,
    [Number(companyId), userId ? Number(userId) : null, String(type), String(title), body, refType, refId, link, String(dedupKey)]
  );
  return r.rows[0]?.id || null;
}

// Recalcula/insere as notificações de sistema do dia para uma empresa:
//  - contratos (mensais) a vencer hoje
//  - cobranças atrasadas há mais de 60 dias
// Cliente novo é emitido diretamente na rota de cadastro.
async function syncSystemNotifications(companyId, now = new Date()) {
  if (!companyId) return;
  const throttleKey = Number(companyId);
  const nowMs = now.getTime();
  if (nowMs - (lastSyncByCompany.get(throttleKey) || 0) < SYNC_THROTTLE_MS) return;
  lastSyncByCompany.set(throttleKey, nowMs);
  const todayIso = formatISODate(now);
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const cutoffIso = formatISODate(addDays(now, -OVERDUE_DAYS));

  // 1) Contratos mensais a vencer hoje (dia de vencimento efetivo = dia de hoje),
  //    ativos, no período e com o mês ainda pendente.
  const due = await query(
    `SELECT c.id AS contract_id, c.description, cl.name AS client_name
       FROM ${SCHEMA}.contracts c
       JOIN ${SCHEMA}.clients cl ON cl.id = c.client_id
       LEFT JOIN ${SCHEMA}.contract_month_status cms
         ON cms.contract_id = c.id AND cms.year = $2 AND cms.month = $3
      WHERE c.company_id = $1
        AND c.active = true
        AND LOWER(COALESCE(c.billing_mode, 'monthly')) = 'monthly'
        AND c.start_date <= $4::date
        AND c.end_date >= $4::date
        AND (c.cancellation_date IS NULL OR c.cancellation_date >= $4::date)
        AND LOWER(COALESCE(cms.status, 'pending')) NOT IN ('paid','canceled')
        AND LEAST(COALESCE(c.billing_day, 1),
                  EXTRACT(DAY FROM (date_trunc('month', $4::date) + INTERVAL '1 month' - INTERVAL '1 day'))::int)
            = EXTRACT(DAY FROM $4::date)::int`,
    [Number(companyId), year, month, todayIso]
  );
  for (const r of due.rows) {
    await createNotification({
      companyId,
      type: 'contract_due_today',
      title: 'Contrato a vencer hoje',
      body: `Contrato #${r.contract_id} · ${r.client_name}`,
      refType: 'contract',
      refId: r.contract_id,
      link: '/notifications/auto',
      dedupKey: `due:${r.contract_id}:${todayIso}`,
    });
  }

  // 2) Cobranças atrasadas há mais de 60 dias (vencimento anterior ao corte),
  //    ainda pendentes, de contratos ativos.
  const overdue = await query(
    `SELECT b.id AS billing_id, b.contract_id, b.billing_date, cl.name AS client_name
       FROM ${SCHEMA}.billings b
       JOIN ${SCHEMA}.contracts c ON c.id = b.contract_id
       JOIN ${SCHEMA}.clients cl ON cl.id = c.client_id
      WHERE b.company_id = $1
        AND LOWER(COALESCE(b.status, 'pending')) NOT IN ('paid','canceled')
        AND b.billing_date < $2::date
        AND c.active = true
        AND (c.cancellation_date IS NULL OR c.cancellation_date >= b.billing_date)`,
    [Number(companyId), cutoffIso]
  );
  for (const r of overdue.rows) {
    await createNotification({
      companyId,
      type: 'billing_overdue_60',
      title: 'Cobrança atrasada há mais de 60 dias',
      body: `Contrato #${r.contract_id} · ${r.client_name} — venc. ${formatBrDate(r.billing_date)}`,
      refType: 'billing',
      refId: r.billing_id,
      link: '/reports/overdue-clients',
      dedupKey: `overdue60:${r.billing_id}`,
    });
  }
}

module.exports = { createNotification, syncSystemNotifications };
