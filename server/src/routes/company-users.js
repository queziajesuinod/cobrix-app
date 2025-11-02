const express = require("express");
const { query } = require("../db");
const { requireAuth } = require("./auth");
const { clearCompanyCache } = require("../services/message-templates");
const { createInstance, formatInstanceName, buildSendUrl, getConnectionState } = require("../services/evo-api");

const router = express.Router();

const MASTER_EMAIL = (process.env.MASTER_EMAIL || process.env.SEED_MASTER_EMAIL || '').trim();
const MASTER_PASSWORD = (process.env.MASTER_PASSWORD || process.env.SEED_MASTER_PASSWORD || '').trim();

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

// LIST all (master)
router.get("/", requireAuth, async (req, res) => {
  if (!isMaster(req.user)) return res.status(403).json({ error: "Apenas master lista todas as empresas" });
  // Master agora lista apenas as empresas às quais está vinculado
  if (req.user.company_ids.length === 0) {
    return res.json([]);
  }
  const r = await query(
    `SELECT id, name, pix_key, evo_api_url, evo_api_key, evo_instance, created_at FROM companies WHERE id = ANY($1::int[]) ORDER BY id DESC`,
    [req.user.company_ids]
  );
  res.json(r.rows);
});

// GET by id
router.get("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!canReadCompany(req.user, req.companyId, id)) return res.status(403).json({ error: "Sem permissão" });
  const r = await query("SELECT id, name, pix_key, evo_api_url, evo_api_key, evo_instance, created_at FROM companies WHERE id=$1", [id]);
  const row = r.rows[0];
  if (!row) return res.status(404).json({ error: "Empresa não encontrada" });
  res.json(row);
});

// CREATE (master)
router.post("/", requireAuth, async (req, res) => {
  if (!isMaster(req.user)) return res.status(403).json({ error: "Apenas master cria empresa" });
  const { name, pix_key } = req.body || {};
  if (!name || String(name).trim().length < 2) return res.status(400).json({ error: "Nome obrigatório" });
  if (!process.env.EVO_API_URL || !process.env.EVO_API_KEY) {
    return res.status(500).json({ error: "Configuração EVO_API_URL/EVO_API_KEY ausente" });
  }
  if (!MASTER_EMAIL || !MASTER_PASSWORD) {
    return res.status(500).json({ error: "MASTER_EMAIL/MASTER_PASSWORD não configurados" });
  }
  const trimmed = String(name).trim();
  const insert = await query(
    "INSERT INTO companies (name, pix_key) VALUES ($1,$2) RETURNING id, name",
    [trimmed, pix_key || null]
  );
  const newCompany = insert.rows[0];

  let instanceName = formatInstanceName(trimmed, newCompany.id);
  try {
    const created = await createInstance(instanceName);
    const sendUrl = buildSendUrl(instanceName);
    await query(
      "UPDATE companies SET evo_instance=$1, evo_api_url=$2, evo_api_key=$3 WHERE id=$4",
      [instanceName, sendUrl || null, process.env.EVO_API_KEY || null, newCompany.id]
    );

    clearCompanyCache(newCompany.id);

    await query(
      `INSERT INTO user_companies (user_id, company_id) VALUES ($1, $2)`,
      [req.user.id, newCompany.id]
    );

    await ensureEnvMasterUser(newCompany.id);

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
    return res.status(err.status || 502).json({ error: err.message || "Falha ao criar instância EVO", details: err.data || null });
  }
});

// UPDATE (master/admin)
router.put("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!canWriteCompany(req.user, req.companyId, id)) return res.status(403).json({ error: "Sem permissão" });
  const { name, pix_key } = req.body || {};
  if (!name || String(name).trim().length < 2) return res.status(400).json({ error: "Nome obrigatório" });
  try {
    const current = await query("SELECT id, name, evo_instance FROM companies WHERE id=$1", [id]);
    const currentRow = current.rows[0];
    if (!currentRow) return res.status(404).json({ error: "Empresa não encontrada" });

    await query("UPDATE companies SET name=$1, pix_key=$2 WHERE id=$3", [String(name).trim(), pix_key || null, id]);

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
    const updatedRow = await query("SELECT id, name, pix_key, evo_instance FROM companies WHERE id=$1", [id]);
    res.json({ ...updatedRow.rows[0], integration });
  } catch (err) {
    console.error('Erro ao atualizar empresa (company-users):', err);
    return res.status(err.status || 500).json({ error: err.message || "Erro ao atualizar empresa", details: err.data || null });
  }
});

// DELETE (master)
router.delete("/:id", requireAuth, async (req, res) => {
  if (!isMaster(req.user)) return res.status(403).json({ error: "Apenas master remove empresa" });
  const id = Number(req.params.id);
  // Remover todos os vínculos de user_companies antes de deletar a empresa
  await query("DELETE FROM user_companies WHERE company_id = $1", [id]);
  const r = await query("DELETE FROM companies WHERE id=$1 RETURNING id", [id]);
  if (!r.rows[0]) return res.status(404).json({ error: "Empresa não encontrada" });
  res.json({ ok: true });
});

module.exports = router;
