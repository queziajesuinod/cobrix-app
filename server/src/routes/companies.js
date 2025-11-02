const express = require("express");
const { query } = require("../db");
const { clearCompanyCache } = require("../services/message-templates");
const { requireAuth } = require("./auth");

const router = express.Router();

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
    `SELECT id, name, pix_key, evo_api_url, evo_api_key, created_at FROM companies WHERE id = ANY($1::int[]) ORDER BY id DESC`,
    [req.user.company_ids]
  );
  res.json(r.rows);
});

// GET by id
router.get("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!canReadCompany(req.user, req.companyId, id)) return res.status(403).json({ error: "Sem permissão" });
  const r = await query("SELECT id, name, pix_key, evo_api_url, evo_api_key, created_at FROM companies WHERE id=$1", [id]);
  const row = r.rows[0];
  if (!row) return res.status(404).json({ error: "Empresa não encontrada" });
  res.json(row);
});

// CREATE (master)
router.post("/", requireAuth, async (req, res) => {
  if (!isMaster(req.user)) return res.status(403).json({ error: "Apenas master cria empresa" });
  const { name, evo_api_url, evo_api_key, pix_key } = req.body || {};
  if (!name || String(name).trim().length < 2) return res.status(400).json({ error: "Nome obrigatório" });
  const r = await query(
    "INSERT INTO companies (name, evo_api_url, evo_api_key, pix_key) VALUES ($1,$2,$3,$4) RETURNING id, name",
    [String(name).trim(), evo_api_url || null, evo_api_key || null, pix_key || null]
  );
  const newCompany = r.rows[0];
  clearCompanyCache(newCompany.id);

  // Vincular o usuário master à nova empresa criada
  await query(
    `INSERT INTO user_companies (user_id, company_id) VALUES ($1, $2)`,
    [req.user.id, newCompany.id]
  );

  res.status(201).json(newCompany);
});

// UPDATE (master/admin)
router.put("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!canWriteCompany(req.user, req.companyId, id)) return res.status(403).json({ error: "Sem permissão" });
  const { name, evo_api_url, evo_api_key, pix_key } = req.body || {};
  if (!name || String(name).trim().length < 2) return res.status(400).json({ error: "Nome obrigatório" });
  const r = await query("UPDATE companies SET name=$1, evo_api_url=$2, evo_api_key=$3, pix_key=$4 WHERE id=$5 RETURNING id, name", [String(name).trim(), evo_api_url || null, evo_api_key || null, pix_key || null, id]);
  const updated = r.rows[0];
  if (!updated) return res.status(404).json({ error: "Empresa não encontrada" });
  clearCompanyCache(id);
  res.json(updated);
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
