// server/src/routes/public.js
// Rotas PÚBLICAS (sem autenticação) — vitrine de planos e inscrição (Fase 2).
// A inscrição provisiona, numa transação: empresa-cliente (pending_payment) +
// usuário admin (perfil Administrador, limitado pelo teto do plano) + cliente e
// contrato no tenant do OWNER (para cobrar a mensalidade). O pagamento e a
// ativação do acesso vêm na Fase 3.
const express = require('express');
const { query, withClient } = require('../db');
const { ensureDateOnly, formatISODate } = require('../utils/date-only');
const { resolvePixPayment } = require('../services/pix-resolver');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const router = express.Router();

const normEmail = (v) => (v ? String(v).trim().toLowerCase() : null);
const normPhone = (v) => (v ? String(v).replace(/\D+/g, '') : null);

function splitDocument(value) {
  if (value == null || value === '') return { cpf: null, cnpj: null };
  const d = String(value).replace(/\D+/g, '');
  if (!d) return { cpf: null, cnpj: null };
  if (d.length === 11) return { cpf: d, cnpj: null };
  if (d.length === 14) return { cpf: null, cnpj: d };
  const err = new Error('Documento deve ter 11 dígitos (CPF) ou 14 dígitos (CNPJ)');
  err.status = 400;
  throw err;
}

// Vitrine: planos ativos, sem dados sensíveis.
router.get('/plans', async (_req, res) => {
  try {
    const r = await query(
      `SELECT id, name, description, price_monthly, price_annual, clients_limit, contracts_limit, permission_keys
         FROM ${SCHEMA}.plans
        WHERE active = true
        ORDER BY price_monthly ASC NULLS LAST, name ASC`
    );
    res.json({ plans: r.rows });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao carregar planos' });
  }
});

// Inscrição pública.
router.post('/signup', async (req, res) => {
  const b = req.body || {};
  const planId = Number(b.plan_id);
  const period = String(b.period || 'monthly').toLowerCase();
  const companyName = String(b.company_name || '').trim();
  const adminName = String(b.admin_name || '').trim();
  const email = normEmail(b.admin_email);
  const password = String(b.admin_password || '');
  const phone = normPhone(b.phone);
  const code = b.code ? String(b.code).trim() : null;

  // Validação de entrada.
  if (!Number.isInteger(planId)) return res.status(400).json({ error: 'Selecione um plano' });
  if (!['monthly', 'annual'].includes(period)) return res.status(400).json({ error: 'Período inválido' });
  if (companyName.length < 2) return res.status(400).json({ error: 'Informe o nome da empresa' });
  if (adminName.length < 2) return res.status(400).json({ error: 'Informe o seu nome' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido' });
  if (password.length < 6) return res.status(400).json({ error: 'A senha deve ter ao menos 6 caracteres' });

  let docFields;
  try { docFields = splitDocument(b.document); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }

  try {
    // Plano ativo + preço do período escolhido.
    const planRes = await query(
      `SELECT id, name, price_monthly, price_annual, clients_limit, contracts_limit
         FROM ${SCHEMA}.plans WHERE id = $1 AND active = true`,
      [planId]
    );
    const plan = planRes.rows[0];
    if (!plan) return res.status(400).json({ error: 'Plano indisponível' });
    const price = period === 'annual' ? plan.price_annual : plan.price_monthly;
    if (price == null) return res.status(400).json({ error: 'Este plano não oferece o período selecionado' });

    // E-mail único (users.email é UNIQUE).
    const emailTaken = await query(`SELECT 1 FROM ${SCHEMA}.users WHERE LOWER(email) = $1`, [email]);
    if (emailTaken.rowCount) return res.status(409).json({ error: 'Este e-mail já está cadastrado' });

    // Empresa dona do SaaS (recebe a assinatura).
    const ownerRes = await query(`SELECT id FROM ${SCHEMA}.companies WHERE is_saas_owner = true LIMIT 1`);
    const ownerId = ownerRes.rows[0]?.id;
    if (!ownerId) return res.status(503).json({ error: 'Inscrição indisponível no momento. Tente novamente mais tarde.' });

    // Perfil Administrador (o teto do plano é quem limita o acesso efetivo).
    const profRes = await query(`SELECT id FROM ${SCHEMA}.profiles WHERE name = 'Administrador' LIMIT 1`);
    const adminProfileId = profRes.rows[0]?.id || null;

    const today = ensureDateOnly(new Date()) || new Date();
    const todayIso = formatISODate(today);
    const endIso = formatISODate(new Date(today.getFullYear() + 10, today.getMonth(), today.getDate()));
    const billingDay = today.getDate();
    const intervalMonths = period === 'annual' ? 12 : 1;

    const result = await withClient(async (client) => {
      await client.query('BEGIN');
      try {
        // Tipo de contrato recorrente no tenant do owner (usa o existente ou cria).
        let typeRes = await client.query(
          `SELECT id FROM ${SCHEMA}.contract_types WHERE company_id = $1 ORDER BY is_recurring DESC, id ASC LIMIT 1`,
          [ownerId]
        );
        let contractTypeId = typeRes.rows[0]?.id;
        if (!contractTypeId) {
          const ct = await client.query(
            `INSERT INTO ${SCHEMA}.contract_types (company_id, name, is_recurring, adjustment_percent) VALUES ($1, 'Recorrente', true, 0) RETURNING id`,
            [ownerId]
          );
          contractTypeId = ct.rows[0].id;
        }

        // 1) Empresa-cliente provisionada (aguardando pagamento).
        const compRes = await client.query(
          `INSERT INTO ${SCHEMA}.companies (name, status, plan_id, clients_limit, contracts_limit)
           VALUES ($1, 'pending_payment', $2, $3, $4) RETURNING id`,
          [companyName, plan.id, plan.clients_limit, plan.contracts_limit]
        );
        const newCompanyId = compRes.rows[0].id;

        // 2) Usuário admin da empresa (role admin, perfil Administrador).
        const userRes = await client.query(
          `INSERT INTO ${SCHEMA}.users (email, password_hash, role, active, name, profile_id, created_at)
           VALUES ($1, public.crypt($2, public.gen_salt('bf', 12)), 'admin', true, $3, $4, now())
           RETURNING id`,
          [email, password, adminName, adminProfileId]
        );
        const newUserId = userRes.rows[0].id;
        await client.query(
          `INSERT INTO ${SCHEMA}.user_companies (user_id, company_id) VALUES ($1, $2)`,
          [newUserId, newCompanyId]
        );

        // 3) Cliente no tenant do owner (a empresa vira meu cliente).
        const cliRes = await client.query(
          `INSERT INTO ${SCHEMA}.clients (company_id, name, email, phone, responsavel, document_cpf, document_cnpj)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [ownerId, companyName, email, phone, adminName, docFields.cpf, docFields.cnpj]
        );
        const ownerClientId = cliRes.rows[0].id;

        // 4) Contrato da mensalidade no tenant do owner (cobrança recorrente).
        const description = `Assinatura ${plan.name} (${period === 'annual' ? 'anual' : 'mensal'}) — ${companyName}`;
        const conRes = await client.query(
          `INSERT INTO ${SCHEMA}.contracts
             (company_id, client_id, contract_type_id, description, value, start_date, end_date, billing_day, billing_interval_months, billing_mode)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'monthly') RETURNING id`,
          [ownerId, ownerClientId, contractTypeId, description, price, todayIso, endIso, billingDay, intervalMonths]
        );
        const ownerContractId = conRes.rows[0].id;

        // 4b) Primeira cobrança da assinatura (a que o cliente paga agora). Marca
        // last_billed_date=hoje para o billing-cron NÃO gerar uma cobrança
        // duplicada no mesmo dia (dedup da 1ª mensalidade).
        const billRes = await client.query(
          `INSERT INTO ${SCHEMA}.billings (company_id, contract_id, billing_date, amount, status)
           VALUES ($1, $2, $3, $4, 'pending')
           ON CONFLICT (contract_id, billing_date) DO NOTHING
           RETURNING id`,
          [ownerId, ownerContractId, todayIso, price]
        );
        const firstBillingId = billRes.rows[0]?.id || null;
        await client.query(
          `INSERT INTO ${SCHEMA}.contract_month_status (company_id, contract_id, year, month, status)
           VALUES ($1, $2, $3, $4, 'pending')
           ON CONFLICT (contract_id, year, month) DO NOTHING`,
          [ownerId, ownerContractId, today.getFullYear(), today.getMonth() + 1]
        );
        await client.query(`UPDATE ${SCHEMA}.contracts SET last_billed_date=$1 WHERE id=$2`, [todayIso, ownerContractId]);

        // 5) Assinatura (a "cola") — status pending_payment até o pagamento confirmar.
        const subRes = await client.query(
          `INSERT INTO ${SCHEMA}.company_subscriptions
             (company_id, plan_id, period, owner_company_id, client_id, contract_id, promo_code, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_payment') RETURNING id`,
          [newCompanyId, plan.id, period, ownerId, ownerClientId, ownerContractId, code]
        );

        await client.query('COMMIT');
        return { companyId: newCompanyId, subscriptionId: subRes.rows[0].id, contractId: ownerContractId, firstBillingId, description };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    // Gera o PIX da 1ª cobrança FORA da transação. resolvePixPayment usa a Efí
    // (dinâmico) quando o owner tem gateway; senão cai no PIX estático da chave
    // PIX do owner. Best-effort: sem gateway nem chave, segue sem PIX.
    let pix = null;
    if (result.firstBillingId) {
      const link = await resolvePixPayment({
        companyId: ownerId,
        contractId: result.contractId,
        billingId: result.firstBillingId,
        amount: Number(price),
        dueDate: todayIso,
        contractDescription: result.description,
        clientName: companyName,
        clientDocument: { cpf: docFields.cpf, cnpj: docFields.cnpj },
      });
      if (link) {
        pix = {
          copyPaste: link.copyPaste || null,
          qrCodeImage: link.qrCodeImage || null,
          amount: Number(link.amount || price),
        };
      }
    }

    res.status(201).json({
      ok: true,
      status: 'pending_payment',
      companyId: result.companyId,
      subscriptionId: result.subscriptionId,
      plan: plan.name,
      period,
      amount: Number(price),
      pix,
      message: 'Cadastro criado. Pague o PIX abaixo — assim que o pagamento for confirmado, seu acesso será liberado automaticamente.',
    });
  } catch (err) {
    if (String(err.message || '').includes('duplicate key')) {
      return res.status(409).json({ error: 'Este e-mail já está cadastrado' });
    }
    console.error('[public/signup] falhou', err);
    res.status(500).json({ error: 'Falha ao concluir a inscrição. Tente novamente.' });
  }
});

module.exports = router;
