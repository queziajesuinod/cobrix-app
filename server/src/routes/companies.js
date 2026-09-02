const express = require("express");
const { query } = require("../db");
const { clearCompanyCache } = require("../services/message-templates");
const { mapGatewayResponse, buildGatewayUpdate } = require("../services/company-gateway");
const { createInstance, formatInstanceName, buildSendUrl, getConnectionState, restartInstance, deleteInstance, resolveBase } = require("../services/evo-api");
const { requireAuth } = require("./auth");

const router = express.Router();
const SCHEMA = process.env.DB_SCHEMA || 'public';

const MASTER_EMAIL = (process.env.MASTER_EMAIL || process.env.SEED_MASTER_EMAIL || "").trim();
const MASTER_PASSWORD = (process.env.MASTER_PASSWORD || process.env.SEED_MASTER_PASSWORD || "").trim();

async function ensureEnvMasterUser(companyId) {
  if (!MASTER_EMAIL || !MASTER_PASSWORD) throw new Error('MASTER_EMAIL/MASTER_PASSWORD não configurados');

  let userId;
  const existing = await query(`SELECT id FROM users WHERE email=$1`, [MASTER_EMAIL]);
  if (existing.rowCount) {
    userId = existing.rows[0].id;
    await query(
      `UPDATE users SET password_hash = public.crypt($1, public.gen_salt('bf', 12)), role='master', active=true WHERE id=$2`,
      [MASTER_PASSWORD, userId]
    );
  } else {
    const inserted = await query(
      `INSERT INTO users (email, password_hash, role, active, created_at)
       VALUES ($1, public.crypt($2, public.gen_salt('bf', 12)), 'master', true, NOW())
       RETURNING id`,
      [MASTER_EMAIL, MASTER_PASSWORD]
    );
    userId = inserted.rows[0].id;
  }

  await query(
    `INSERT INTO user_companies (user_id, company_id)
     VALUES ($1,$2)
     ON CONFLICT DO NOTHING`,
    [userId, companyId]
  );

  return userId;
}

function isMaster(user) { return user?.role === "master"; }

function canReadCompany(user, selectedCompanyId, targetCompanyId) {
  if (!user) return false;
  if (isMaster(user)) {
    // Master pode ler qualquer empresa à qual está vinculado
    return user.company_ids.includes(Number(targetCompanyId));
  }
  // Usuário normal só pode ler a empresa à qual está vinculado e que foi selecionada
  return user.company_ids.includes(Number(targetCompanyId)) && Number(selectedCompanyId) === Number(targetCompanyId);
}

function canWriteCompany(user, selectedCompanyId, targetCompanyId) {
  if (!user) return false;
  if (isMaster(user)) {
    // Master pode escrever em qualquer empresa à qual está vinculado
    return user.company_ids.includes(Number(targetCompanyId));
  }
  // Usuário normal (ou admin) só pode escrever na empresa à qual está vinculado e que foi selecionada
  if (user?.role === "admin") {
    return user.company_ids.includes(Number(targetCompanyId)) && Number(selectedCompanyId) === Number(targetCompanyId);
  }
  return false;
}

// CPF (11) ou CNPJ (14) a partir de uma string livre. Vazio = zera os dois.
function parseDocument(value) {
  if (value == null || value === '') return { cpf: null, cnpj: null };
  const d = String(value).replace(/\D+/g, '');
  if (!d) return { cpf: null, cnpj: null };
  if (d.length === 11) return { cpf: d, cnpj: null };
  if (d.length === 14) return { cpf: null, cnpj: d };
  const e = new Error('Documento deve ter 11 dígitos (CPF) ou 14 dígitos (CNPJ)'); e.status = 400; throw e;
}

function parseLimitField(value, label) {
  if (value === undefined || value === null) return null;
  const str = typeof value === 'string' ? value.trim() : value;
  if (str === '') return null;
  const parsed = Number(str);
  if (!Number.isInteger(parsed) || parsed < 0) {
    const err = new Error(`Limite de ${label} inválido`);
    err.status = 400;
    throw err;
  }
  return parsed;
}

// LIST all (master)
router.get("/", requireAuth, async (req, res) => {
  if (!isMaster(req.user)) return res.status(403).json({ error: "Apenas master lista todas as empresas" });
  // Master agora lista apenas as empresas às quais está vinculado
  if (req.user.company_ids.length === 0) {
    return res.json([]);
  }
  const r = await query(
    `SELECT id, name, pix_key, evo_api_url, evo_api_key, evo_instance, clients_limit, contracts_limit, plan_id, status, is_saas_owner, is_partner, parent_partner_id, partner_override_type, partner_override_value, reseller_status, reseller_delinquent_since, created_at, updated_at,
            (SELECT COALESCE(NULLIF(cu.name,''), cu.email) FROM users cu WHERE cu.id = companies.created_by) AS created_by_name,
            (SELECT COALESCE(NULLIF(eu.name,''), eu.email) FROM users eu WHERE eu.id = companies.updated_by) AS updated_by_name,
            efi_client_id_enc, efi_client_secret_enc, efi_cert_base64_enc FROM companies WHERE id = ANY($1::int[]) ORDER BY id DESC`,
    [req.user.company_ids]
  );
  const rows = r.rows.map(mapGatewayResponse);
  res.json(rows);
});

// LIST das empresas do próprio usuário (id+name) — alimenta o seletor de empresa.
// Diferente de "/" (master, dados completos), esta serve qualquer papel e devolve
// só o necessário para trocar de empresa. Deve vir ANTES de "/:id".
router.get("/mine", requireAuth, async (req, res) => {
  const ids = req.user.company_ids || [];
  if (ids.length === 0) return res.json([]);
  const r = await query(
    `SELECT id, name FROM companies WHERE id = ANY($1::int[]) ORDER BY name ASC`,
    [ids]
  );
  res.json(r.rows);
});

// GET by id
router.get("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!canReadCompany(req.user, req.companyId, id)) return res.status(403).json({ error: "Sem permissão" });
  const r = await query(`SELECT id, name, pix_key, document_cpf, document_cnpj, evo_api_url, evo_api_key, evo_instance, clients_limit, contracts_limit, plan_id, status, is_saas_owner, is_partner, parent_partner_id, partner_override_type, partner_override_value, reseller_status, reseller_delinquent_since, created_at, updated_at,
    (SELECT COALESCE(NULLIF(cu.name,''), cu.email) FROM users cu WHERE cu.id = companies.created_by) AS created_by_name,
    (SELECT COALESCE(NULLIF(eu.name,''), eu.email) FROM users eu WHERE eu.id = companies.updated_by) AS updated_by_name,
    efi_client_id_enc, efi_client_secret_enc, efi_cert_base64_enc FROM companies WHERE id=$1`, [id]);
  const row = r.rows[0];
  if (!row) return res.status(404).json({ error: "Empresa não encontrada" });
  res.json(mapGatewayResponse(row));
});

// CREATE (master)
router.post("/", requireAuth, async (req, res) => {
  if (!isMaster(req.user)) return res.status(403).json({ error: "Apenas master cria empresa" });
  const { name, pix_key, clients_limit, contracts_limit, gateway_client_id, gateway_client_secret, gateway_cert_base64 } = req.body || {};
  if (!name || String(name).trim().length < 2) return res.status(400).json({ error: "Nome obrigatório" });
  if (!process.env.EVO_API_URL || !process.env.EVO_API_KEY) {
    return res.status(500).json({ error: "Configuração EVO_API_URL/EVO_API_KEY ausente" });
  }
  if (!MASTER_EMAIL || !MASTER_PASSWORD) {
    return res.status(500).json({ error: "MASTER_EMAIL/MASTER_PASSWORD não configurados" });
  }
  let normalizedClientLimit;
  let normalizedContractLimit;
  try {
    normalizedClientLimit = parseLimitField(clients_limit, 'clientes');
    normalizedContractLimit = parseLimitField(contracts_limit, 'contratos');
  } catch (limitErr) {
    return res.status(limitErr.status || 400).json({ error: limitErr.message });
  }

  let gatewayColumns;
  try {
    gatewayColumns = buildGatewayUpdate({
      clientIdInput: gateway_client_id,
      clientSecretInput: gateway_client_secret,
      certificateBase64Input: gateway_cert_base64,
    });
  } catch (gatewayErr) {
    return res.status(400).json({ error: gatewayErr.message });
  }

  const client = String(name).trim();
  const insert = await query(
    "INSERT INTO companies (name, pix_key, clients_limit, contracts_limit, efi_client_id_enc, efi_client_secret_enc, efi_cert_base64_enc, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, pix_key, clients_limit, contracts_limit, efi_client_id_enc, efi_client_secret_enc, efi_cert_base64_enc",
    [client, pix_key || null, normalizedClientLimit, normalizedContractLimit, gatewayColumns.clientIdEnc, gatewayColumns.clientSecretEnc, gatewayColumns.certBase64Enc, req.user.id]
  );
  const newCompany = mapGatewayResponse(insert.rows[0]);
  let instanceName = formatInstanceName(client, newCompany.id);

  try {
    const created = await createInstance(instanceName);

    const sendUrl = buildSendUrl(instanceName);
    await query(
      "UPDATE companies SET evo_instance=$1, evo_api_url=$2, evo_api_key=$3 WHERE id=$4",
      [instanceName, sendUrl || null, process.env.EVO_API_KEY || null, newCompany.id]
    );

    clearCompanyCache(newCompany.id);

    // Vincular o usuário master à nova empresa criada
    await query(
      `INSERT INTO user_companies (user_id, company_id) VALUES ($1, $2)`,
      [req.user.id, newCompany.id]
    );

    await ensureEnvMasterUser(newCompany.id);
    await query(
      `INSERT INTO ${SCHEMA}.contract_types (company_id, name, is_recurring, adjustment_percent)
       VALUES ($1,'Fixo',false,0)
       ON CONFLICT (company_id, name) DO NOTHING`,
      [newCompany.id]
    );
    await query(
      `INSERT INTO ${SCHEMA}.contract_types (company_id, name, is_recurring, adjustment_percent)
       VALUES ($1,'Recorrente',true,5)
       ON CONFLICT (company_id, name) DO NOTHING`,
      [newCompany.id]
    );

    const connection = await getConnectionState(instanceName).catch(() => null);

    res.status(201).json({
      ...newCompany,
      evo_instance: instanceName,
      integration: {
        instance: instanceName,
        qrcode: created?.qrcode ?? created?.data?.qrcode ?? null,
        connectionStatus: connection?.connectionStatus || created?.connectionStatus || 'pending',
      },
    });
  } catch (err) {
    await query("DELETE FROM companies WHERE id=$1", [newCompany.id]);
    const message = err?.message || "Falha ao criar instância EVO";
    return res.status(err.status || 502).json({ error: message, details: err.data || null });
  }
});

// UPDATE (master/admin)
router.put("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!canWriteCompany(req.user, req.companyId, id)) return res.status(403).json({ error: "Sem permissão" });
  const payload = req.body || {};
  const { name, pix_key, clients_limit, contracts_limit } = payload;
  if (!name || String(name).trim().length < 2) return res.status(400).json({ error: "Nome obrigatório" });
  let normalizedClientLimit;
  let normalizedContractLimit;
  try {
    normalizedClientLimit = parseLimitField(clients_limit, 'clientes');
    normalizedContractLimit = parseLimitField(contracts_limit, 'contratos');
  } catch (limitErr) {
    return res.status(limitErr.status || 400).json({ error: limitErr.message });
  }

  const hasGatewayId = Object.prototype.hasOwnProperty.call(payload, 'gateway_client_id');
  const hasGatewaySecret = Object.prototype.hasOwnProperty.call(payload, 'gateway_client_secret');
  const hasGatewayCert = Object.prototype.hasOwnProperty.call(payload, 'gateway_cert_base64');

  try {
    const current = await query("SELECT id, name, evo_instance, efi_client_id_enc, efi_client_secret_enc, efi_cert_base64_enc FROM companies WHERE id=$1", [id]);
    const currentRow = current.rows[0];
    if (!currentRow) return res.status(404).json({ error: "Empresa não encontrada" });

    let gatewayColumns;
    try {
      gatewayColumns = buildGatewayUpdate({
        clientIdInput: hasGatewayId ? payload.gateway_client_id : undefined,
        clientSecretInput: hasGatewaySecret ? payload.gateway_client_secret : undefined,
        currentClientIdEnc: currentRow.efi_client_id_enc || null,
        currentSecretEnc: currentRow.efi_client_secret_enc || null,
        certificateBase64Input: hasGatewayCert ? payload.gateway_cert_base64 : undefined,
        currentCertEnc: currentRow.efi_cert_base64_enc || null,
      });
    } catch (gatewayErr) {
      return res.status(400).json({ error: gatewayErr.message });
    }

    await query("UPDATE companies SET name=$1, pix_key=$2, efi_client_id_enc=$3, efi_client_secret_enc=$4, efi_cert_base64_enc=$5, updated_by=$6, updated_at=now() WHERE id=$7", [String(name).trim(), pix_key || null, gatewayColumns.clientIdEnc, gatewayColumns.clientSecretEnc, gatewayColumns.certBase64Enc, req.user.id, id]);

    // Cotas do plano (clientes/contratos): SOMENTE master. Impede um admin de furar a
    // própria cota pela tela self-service de "Minha empresa".
    if (isMaster(req.user)) {
      await query("UPDATE companies SET clients_limit=$1, contracts_limit=$2 WHERE id=$3", [normalizedClientLimit, normalizedContractLimit, id]);
    }

    // CPF/CNPJ da empresa (nota fiscal / identificação). Enviado como um campo único
    // `document`; separamos em cpf/cnpj pelo tamanho. Só grava se veio no payload.
    if (Object.prototype.hasOwnProperty.call(payload, 'document')) {
      const doc = parseDocument(payload.document);
      await query("UPDATE companies SET document_cpf=$1, document_cnpj=$2 WHERE id=$3", [doc.cpf, doc.cnpj, id]);
    }

    // Plano (SaaS): somente master define/altera o plano da empresa. Vazio = sem
    // plano (acesso total). O teto passa a valer para os usuários da empresa.
    if (isMaster(req.user) && Object.prototype.hasOwnProperty.call(payload, 'plan_id')) {
      const raw = payload.plan_id;
      const planId = (raw === null || raw === '') ? null : Number(raw);
      if (planId !== null && !Number.isInteger(planId)) {
        return res.status(400).json({ error: 'Plano inválido' });
      }
      if (planId !== null) {
        const pl = await query("SELECT id FROM plans WHERE id=$1", [planId]);
        if (!pl.rows[0]) return res.status(400).json({ error: 'Plano não encontrado' });
      }
      await query("UPDATE companies SET plan_id=$1 WHERE id=$2", [planId, id]);
    }

    // Empresa dona do SaaS: só master define, e só uma empresa pode ser a dona.
    if (isMaster(req.user) && Object.prototype.hasOwnProperty.call(payload, 'is_saas_owner')) {
      if (payload.is_saas_owner) {
        await query("UPDATE companies SET is_saas_owner = (id = $1)", [id]);
      } else {
        await query("UPDATE companies SET is_saas_owner = false WHERE id = $1", [id]);
      }
    }

    // Parceiro (revenda): só master define. Diferente da dona, vários podem ser
    // parceiros ao mesmo tempo (cada um revende e tem seu próprio PIX/gateway).
    if (isMaster(req.user) && Object.prototype.hasOwnProperty.call(payload, 'is_partner')) {
      await query("UPDATE companies SET is_partner=$1 WHERE id=$2", [Boolean(payload.is_partner), id]);
    }

    // Override do parceiro: comissão EXTRA (sobre o piso) que ele ganha da própria
    // rede (aditiva à comissão-base da Padrão). Só master define.
    if (isMaster(req.user) && (Object.prototype.hasOwnProperty.call(payload, 'partner_override_type') || Object.prototype.hasOwnProperty.call(payload, 'partner_override_value'))) {
      const type = payload.partner_override_type === 'fixed' ? 'fixed' : 'percent';
      const rawVal = Number(String(payload.partner_override_value ?? '').replace(',', '.'));
      const value = Number.isFinite(rawVal) && rawVal >= 0 ? rawVal : 0;
      if (type === 'percent' && value > 100) return res.status(400).json({ error: 'Override em % não pode passar de 100' });
      await query("UPDATE companies SET partner_override_type=$1, partner_override_value=$2 WHERE id=$3", [type, value, id]);
    }

    let instanceName = currentRow.evo_instance;
    let integration = null;

    if (!instanceName) {
      if (!process.env.EVO_API_URL || !process.env.EVO_API_KEY) {
        return res.status(500).json({ error: "Configuração EVO_API_URL/EVO_API_KEY ausente" });
      }
      instanceName = formatInstanceName(String(name).trim(), id);
      const created = await createInstance(instanceName);
      const sendUrl = buildSendUrl(instanceName);
      await query(
        "UPDATE companies SET evo_instance=$1, evo_api_url=$2, evo_api_key=$3 WHERE id=$4",
        [instanceName, sendUrl || null, process.env.EVO_API_KEY || null, id]
      );
      const connection = await getConnectionState(instanceName).catch(() => null);
      integration = {
        instance: instanceName,
        qrcode: created?.qrcode ?? created?.data?.qrcode ?? null,
        connectionStatus: connection?.connectionStatus || created?.connectionStatus || 'pending',
      };
    }

    await ensureEnvMasterUser(id);

    clearCompanyCache(id);
    const updatedRow = await query("SELECT id, name, pix_key, clients_limit, contracts_limit, plan_id, status, is_saas_owner, is_partner, parent_partner_id, partner_override_type, partner_override_value, evo_instance, efi_client_id_enc, efi_client_secret_enc, efi_cert_base64_enc FROM companies WHERE id=$1", [id]);
    const formatted = mapGatewayResponse(updatedRow.rows[0]);
    res.json({ ...formatted, integration });
  } catch (err) {
    console.error('Erro ao atualizar empresa:', err);
    return res.status(err.status || 500).json({ error: err.message || "Erro ao atualizar empresa", details: err.data || null });
  }
});

// DELETE (master)
router.delete("/:id", requireAuth, async (req, res) => {
  if (!isMaster(req.user)) return res.status(403).json({ error: "Apenas master remove empresa" });
  const id = Number(req.params.id);
  const rCompany = await query("SELECT id, evo_instance, evo_api_url, evo_api_key FROM companies WHERE id=$1", [id]);
  const companyRow = rCompany.rows[0];
  // Remover todos os vínculos de user_companies antes de deletar a empresa
  await query("DELETE FROM user_companies WHERE company_id = $1", [id]);
  const r = await query("DELETE FROM companies WHERE id=$1 RETURNING id", [id]);
  if (!r.rows[0]) return res.status(404).json({ error: "Empresa não encontrada" });
  if (companyRow?.evo_instance) {
    const evoOptions = {
      baseOverride: resolveBase(companyRow.evo_api_url) || null,
      apiKeyOverride: companyRow.evo_api_key || null,
    };
    deleteInstance(companyRow.evo_instance, evoOptions).catch(err => {
      console.warn('[companies] delete evo instance failed', {
        companyId: id,
        instance: companyRow.evo_instance,
        status: err?.status,
        message: err?.message,
      });
    });
  }
  res.json({ ok: true });
});

// ===================== PREÇOS DE REVENDA DO PARCEIRO =====================
// O parceiro define o preço de venda (mensal/anual) por plano; os ACESSOS e a
// estrutura do plano são da empresa padrão (não editáveis aqui). O preço deve ser
// >= piso (price_monthly/price_annual do plano). Master ou admin da própria empresa.
function parsePartnerMoney(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(2)) : NaN;
}

router.get('/:id/partner-prices', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  if (!canReadCompany(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    // Autossuficiente: planos ativos com o PISO, a contagem de acessos (fixos) e o
    // preço de revenda deste parceiro (my_price_*). Multinível: o PISO é o preço do
    // parceiro ACIMA (parent_partner_id) — pra não furar o preço de quem o trouxe.
    // Sem parceiro pai (ou sem preço dele), cai no piso da plataforma (preço do plano).
    const parentRes = await query('SELECT parent_partner_id FROM companies WHERE id=$1', [id]);
    const parentId = parentRes.rows[0]?.parent_partner_id || null;
    const r = await query(
      `SELECT p.id AS plan_id, p.name, p.active,
              COALESCE(parent_pp.price_monthly, p.price_monthly) AS price_monthly,
              COALESCE(parent_pp.price_annual, p.price_annual) AS price_annual,
              COALESCE(array_length(p.permission_keys, 1), 0) AS permission_count,
              my_pp.price_monthly AS my_price_monthly, my_pp.price_annual AS my_price_annual
         FROM plans p
         LEFT JOIN partner_plan_prices my_pp ON my_pp.plan_id = p.id AND my_pp.partner_id = $1
         LEFT JOIN partner_plan_prices parent_pp ON parent_pp.plan_id = p.id AND parent_pp.partner_id = $2
        WHERE p.active = true
        ORDER BY COALESCE(parent_pp.price_monthly, p.price_monthly) ASC NULLS LAST, p.name ASC`,
      [id, parentId]
    );
    res.json({ plans: r.rows, floor_from: parentId ? 'partner' : 'platform' });
  } catch (err) {
    console.error('[partner-prices] GET', err);
    res.status(500).json({ error: 'Falha ao carregar preços de revenda' });
  }
});

router.put('/:id/partner-prices/:planId', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const planId = Number(req.params.planId);
  if (!Number.isInteger(id) || !Number.isInteger(planId)) return res.status(400).json({ error: 'Parâmetros inválidos' });
  if (!canWriteCompany(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const comp = await query('SELECT is_partner, parent_partner_id FROM companies WHERE id=$1', [id]);
    if (!comp.rows[0]) return res.status(404).json({ error: 'Empresa não encontrada' });
    if (!comp.rows[0].is_partner) return res.status(400).json({ error: 'Empresa não é parceira' });

    const pl = await query('SELECT price_monthly, price_annual FROM plans WHERE id=$1', [planId]);
    if (!pl.rows[0]) return res.status(404).json({ error: 'Plano não encontrado' });
    // Piso = preço do parceiro ACIMA (parent), se houver; senão o piso da plataforma.
    let floorM = pl.rows[0].price_monthly == null ? null : Number(pl.rows[0].price_monthly);
    let floorA = pl.rows[0].price_annual == null ? null : Number(pl.rows[0].price_annual);
    const parentId = comp.rows[0].parent_partner_id || null;
    if (parentId) {
      const pp = await query('SELECT price_monthly, price_annual FROM partner_plan_prices WHERE partner_id=$1 AND plan_id=$2', [parentId, planId]);
      if (pp.rows[0]) {
        if (pp.rows[0].price_monthly != null) floorM = Number(pp.rows[0].price_monthly);
        if (pp.rows[0].price_annual != null) floorA = Number(pp.rows[0].price_annual);
      }
    }

    const pm = parsePartnerMoney(req.body?.price_monthly);
    const pa = parsePartnerMoney(req.body?.price_annual);
    if (Number.isNaN(pm) || Number.isNaN(pa)) return res.status(400).json({ error: 'Valor inválido' });
    if (pm != null) {
      if (floorM == null) return res.status(400).json({ error: 'Este plano não oferece período mensal' });
      if (pm < floorM) return res.status(400).json({ error: `Preço mensal não pode ficar abaixo do piso (${floorM.toFixed(2)})` });
    }
    if (pa != null) {
      if (floorA == null) return res.status(400).json({ error: 'Este plano não oferece período anual' });
      if (pa < floorA) return res.status(400).json({ error: `Preço anual não pode ficar abaixo do piso (${floorA.toFixed(2)})` });
    }

    await query(
      `INSERT INTO partner_plan_prices (partner_id, plan_id, price_monthly, price_annual, created_by, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$5,now())
       ON CONFLICT (partner_id, plan_id)
       DO UPDATE SET price_monthly=EXCLUDED.price_monthly, price_annual=EXCLUDED.price_annual, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [id, planId, pm, pa, req.user.id]
    );
    res.json({ ok: true, plan_id: planId, price_monthly: pm, price_annual: pa });
  } catch (err) {
    console.error('[partner-prices] PUT', err);
    res.status(500).json({ error: 'Falha ao salvar preço de revenda' });
  }
});

// ===================== REDE DO PARCEIRO (sub-parceiros) =====================
// Self-service: o próprio parceiro habilita como SUB-PARCEIRAS as empresas que
// assinaram pela indicação dele (downline DIRETA: parent_partner_id = :id) e define
// o override de cada uma. Antes isso era só do master (PUT /:id). Escopo estrito:
//   - caller admin/master da própria empresa parceira (canRead/canWrite :id);
//   - :id precisa ser parceira e, para escrever, estar com a revenda ATIVA
//     (link_locked/network_seized não onboarda novos sub-parceiros);
//   - o filho precisa ser da downline DIRETA de :id (não mexe em empresa alheia).
router.get('/:id/downline', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  if (!canReadCompany(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const me = await query('SELECT is_partner FROM companies WHERE id=$1', [id]);
    if (!me.rows[0]) return res.status(404).json({ error: 'Empresa não encontrada' });
    if (!me.rows[0].is_partner) return res.status(400).json({ error: 'Empresa não é parceira' });
    const r = await query(
      `SELECT id, name, is_partner, partner_override_type, partner_override_value,
              (pix_key IS NOT NULL OR efi_client_id_enc IS NOT NULL) AS can_receive
         FROM companies
        WHERE parent_partner_id = $1
        ORDER BY name ASC`,
      [id]
    );
    res.json({ companies: r.rows });
  } catch (err) {
    console.error('[downline] GET', err);
    res.status(500).json({ error: 'Falha ao carregar a rede de parceiros' });
  }
});

router.put('/:id/downline/:childId', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const childId = Number(req.params.childId);
  if (!Number.isInteger(id) || !Number.isInteger(childId)) return res.status(400).json({ error: 'Parâmetros inválidos' });
  if (!canWriteCompany(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const me = await query('SELECT is_partner, reseller_status FROM companies WHERE id=$1', [id]);
    if (!me.rows[0]) return res.status(404).json({ error: 'Empresa não encontrada' });
    if (!me.rows[0].is_partner) return res.status(400).json({ error: 'Empresa não é parceira' });
    if (me.rows[0].reseller_status && me.rows[0].reseller_status !== 'active') {
      return res.status(403).json({ error: 'Revenda bloqueada por inadimplência. Regularize para gerenciar sua rede.' });
    }
    const child = await query('SELECT parent_partner_id FROM companies WHERE id=$1', [childId]);
    if (!child.rows[0]) return res.status(404).json({ error: 'Empresa não encontrada' });
    if (Number(child.rows[0].parent_partner_id) !== id) {
      return res.status(403).json({ error: 'Esta empresa não faz parte da sua rede' });
    }

    const isPartner = Boolean(req.body?.is_partner);
    const type = req.body?.partner_override_type === 'fixed' ? 'fixed' : 'percent';
    const rawVal = Number(String(req.body?.partner_override_value ?? '').replace(',', '.'));
    const value = Number.isFinite(rawVal) && rawVal >= 0 ? rawVal : 0;
    if (type === 'percent' && value > 100) return res.status(400).json({ error: 'Override em % não pode passar de 100' });

    await query(
      'UPDATE companies SET is_partner=$1, partner_override_type=$2, partner_override_value=$3 WHERE id=$4',
      [isPartner, type, value, childId]
    );
    clearCompanyCache(childId);
    res.json({ ok: true, id: childId, is_partner: isPartner, partner_override_type: type, partner_override_value: value });
  } catch (err) {
    console.error('[downline] PUT', err);
    res.status(500).json({ error: 'Falha ao salvar sub-parceiro' });
  }
});

// Dados cadastrais/recebimento de uma empresa da rede DIRETA (não é revenda): o
// parceiro ajusta nome, CPF/CNPJ, PIX e gateway das empresas que entraram por ele.
// Mesmo escopo estrito da rede: :id parceira, filho na downline direta de :id.
router.get('/:id/downline/:childId', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const childId = Number(req.params.childId);
  if (!Number.isInteger(id) || !Number.isInteger(childId)) return res.status(400).json({ error: 'Parâmetros inválidos' });
  if (!canReadCompany(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const me = await query('SELECT is_partner FROM companies WHERE id=$1', [id]);
    if (!me.rows[0]) return res.status(404).json({ error: 'Empresa não encontrada' });
    if (!me.rows[0].is_partner) return res.status(400).json({ error: 'Empresa não é parceira' });
    const r = await query(
      `SELECT id, name, pix_key, document_cpf, document_cnpj, parent_partner_id,
              efi_client_id_enc, efi_client_secret_enc, efi_cert_base64_enc
         FROM companies WHERE id=$1`,
      [childId]
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'Empresa não encontrada' });
    if (Number(row.parent_partner_id) !== id) return res.status(403).json({ error: 'Esta empresa não faz parte da sua rede' });
    res.json(mapGatewayResponse(row));
  } catch (err) {
    console.error('[downline] GET one', err);
    res.status(500).json({ error: 'Falha ao carregar empresa da rede' });
  }
});

router.put('/:id/downline/:childId/data', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const childId = Number(req.params.childId);
  if (!Number.isInteger(id) || !Number.isInteger(childId)) return res.status(400).json({ error: 'Parâmetros inválidos' });
  if (!canWriteCompany(req.user, req.companyId, id)) return res.status(403).json({ error: 'Sem permissão' });
  const payload = req.body || {};
  const name = String(payload.name || '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'Nome obrigatório' });
  try {
    const me = await query('SELECT is_partner FROM companies WHERE id=$1', [id]);
    if (!me.rows[0]) return res.status(404).json({ error: 'Empresa não encontrada' });
    if (!me.rows[0].is_partner) return res.status(400).json({ error: 'Empresa não é parceira' });
    const cur = await query('SELECT parent_partner_id, efi_client_id_enc, efi_client_secret_enc, efi_cert_base64_enc FROM companies WHERE id=$1', [childId]);
    const currentRow = cur.rows[0];
    if (!currentRow) return res.status(404).json({ error: 'Empresa não encontrada' });
    if (Number(currentRow.parent_partner_id) !== id) return res.status(403).json({ error: 'Esta empresa não faz parte da sua rede' });

    const doc = parseDocument(payload.document);
    const hasGatewayId = Object.prototype.hasOwnProperty.call(payload, 'gateway_client_id');
    const hasGatewaySecret = Object.prototype.hasOwnProperty.call(payload, 'gateway_client_secret');
    const hasGatewayCert = Object.prototype.hasOwnProperty.call(payload, 'gateway_cert_base64');
    let gatewayColumns;
    try {
      gatewayColumns = buildGatewayUpdate({
        clientIdInput: hasGatewayId ? payload.gateway_client_id : undefined,
        clientSecretInput: hasGatewaySecret ? payload.gateway_client_secret : undefined,
        currentClientIdEnc: currentRow.efi_client_id_enc || null,
        currentSecretEnc: currentRow.efi_client_secret_enc || null,
        certificateBase64Input: hasGatewayCert ? payload.gateway_cert_base64 : undefined,
        currentCertEnc: currentRow.efi_cert_base64_enc || null,
      });
    } catch (gatewayErr) {
      return res.status(400).json({ error: gatewayErr.message });
    }

    await query(
      `UPDATE companies SET name=$1, pix_key=$2, document_cpf=$3, document_cnpj=$4,
              efi_client_id_enc=$5, efi_client_secret_enc=$6, efi_cert_base64_enc=$7, updated_by=$8, updated_at=now()
        WHERE id=$9`,
      [name, payload.pix_key ? String(payload.pix_key).trim() : null, doc.cpf, doc.cnpj,
       gatewayColumns.clientIdEnc, gatewayColumns.clientSecretEnc, gatewayColumns.certBase64Enc, req.user.id, childId]
    );
    clearCompanyCache(childId);
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[downline] PUT data', err);
    res.status(500).json({ error: 'Falha ao salvar dados da empresa' });
  }
});

module.exports = router;













