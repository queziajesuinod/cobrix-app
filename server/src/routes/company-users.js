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
      `UPDATE users SET password_hash = public.crypt($1, public.gen_salt('bf')), role='master', active=true WHERE id=$2`,
      [MASTER_PASSWORD, userId]
    );
  } else {
    const inserted = await query(
      `INSERT INTO users (email, password_hash, role, active, created_at)
       VALUES ($1, public.crypt($2, public.gen_salt('bf')), 'master', true, NOW())
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

function parseLimitField(value, label) {
  if (value === undefined || value === null) return null;
  const str = typeof value === 'string' ? value.trim() : value;
  if (str === '') return null;
  const parsed = Number(str);
  if (!Number.isInteger(parsed) || parsed < 0) {
    const err = new Error(`Limite de ${label} invalido`);
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
    `SELECT id, name, pix_key, evo_api_url, evo_api_key, evo_instance, clients_limit, contracts_limit, created_at,
            efi_client_id_enc, efi_client_secret_enc, efi_cert_base64_enc FROM companies WHERE id = ANY($1::int[]) ORDER BY id DESC`,
    [req.user.company_ids]
  );
  const rows = r.rows.map(mapGatewayResponse);
  res.json(rows);
});

// GET by id
router.get(":id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!canReadCompany(req.user, req.companyId, id)) return res.status(403).json({ error: "Sem permiss�o" });
  const r = await query("SELECT id, name, pix_key, evo_api_url, evo_api_key, evo_instance, clients_limit, contracts_limit, created_at, efi_client_id_enc, efi_client_secret_enc, efi_cert_base64_enc FROM companies WHERE id=$1", [id]);
  const row = r.rows[0];
  if (!row) return res.status(404).json({ error: "Empresa n�o encontrada" });
  res.json(mapGatewayResponse(row));
});

// CREATE (master)
router.post("/", requireAuth, async (req, res) => {
  if (!isMaster(req.user)) return res.status(403).json({ error: "Apenas master cria empresa" });
  const { name, pix_key, clients_limit, contracts_limit, gateway_client_id, gateway_client_secret, gateway_cert_base64 } = req.body || {};
  if (!name || String(name).trim().length < 2) return res.status(400).json({ error: "Nome obrigat??rio" });
  if (!process.env.EVO_API_URL || !process.env.EVO_API_KEY) {
    return res.status(500).json({ error: "Configura??uo EVO_API_URL/EVO_API_KEY ausente" });
  }
  if (!MASTER_EMAIL || !MASTER_PASSWORD) {
    return res.status(500).json({ error: "MASTER_EMAIL/MASTER_PASSWORD nuo configurados" });
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
    "INSERT INTO companies (name, pix_key, clients_limit, contracts_limit, efi_client_id_enc, efi_client_secret_enc, efi_cert_base64_enc) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, pix_key, clients_limit, contracts_limit, efi_client_id_enc, efi_client_secret_enc, efi_cert_base64_enc",
    [client, pix_key || null, normalizedClientLimit, normalizedContractLimit, gatewayColumns.clientIdEnc, gatewayColumns.clientSecretEnc, gatewayColumns.certBase64Enc]
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
  if (!name || String(name).trim().length < 2) return res.status(400).json({ error: "Nome obrigat??rio" });
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
    if (!currentRow) return res.status(404).json({ error: "Empresa nuo encontrada" });

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

    await query("UPDATE companies SET name=$1, pix_key=$2, clients_limit=$3, contracts_limit=$4, efi_client_id_enc=$5, efi_client_secret_enc=$6, efi_cert_base64_enc=$7 WHERE id=$8", [String(name).trim(), pix_key || null, normalizedClientLimit, normalizedContractLimit, gatewayColumns.clientIdEnc, gatewayColumns.clientSecretEnc, gatewayColumns.certBase64Enc, id]);

    let instanceName = currentRow.evo_instance;
    let integration = null;

    if (!instanceName) {
      if (!process.env.EVO_API_URL || !process.env.EVO_API_KEY) {
        return res.status(500).json({ error: "Configura??uo EVO_API_URL/EVO_API_KEY ausente" });
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
    const updatedRow = await query("SELECT id, name, pix_key, clients_limit, contracts_limit, evo_instance, efi_client_id_enc, efi_client_secret_enc, efi_cert_base64_enc FROM companies WHERE id=$1", [id]);
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

module.exports = router;





