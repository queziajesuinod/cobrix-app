// server/src/routes/company-users.js
const express = require('express');
const { z } = require('zod');
const { query } = require('../db');
const { requireAuth } = require('./auth');

const router = express.Router();
const schema = process.env.DB_SCHEMA || 'public';

// helpers simples de perm
function canRead(user, reqCompanyId, targetCompanyId) {
  if (!user) return false;
  if (user.role === 'master') return true;
  const cid = Number(reqCompanyId ?? user.company_id ?? 0);
  return cid === Number(targetCompanyId);
}
function canWrite(user, reqCompanyId, targetCompanyId) {
  // ajuste se tiver papel admin; por hora igual ao canRead
  return canRead(user, reqCompanyId, targetCompanyId);
}

/**
 * GET /companies/:id/users
 * Lista usuários da empresa
 */
router.get('/:id/users', requireAuth, async (req, res) => {
  const companyId = Number(req.params.id);
  if (!Number.isFinite(companyId)) {
    return res.status(400).json({ error: 'companyId inválido' });
  }
  if (!canRead(req.user, req.companyId, companyId)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  try {
    const r = await query(
      `SELECT id, email, role, active, company_id
       FROM ${schema}.users
       WHERE company_id = $1
       ORDER BY id DESC`,
      [companyId]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /companies/:id/users
 * Cria usuário da empresa
 * Body: { email, password, role? }
 */
router.post('/:id/users', requireAuth, async (req, res) => {
  const companyId = Number(req.params.id); // 👈 use o id da rota!
  if (!Number.isFinite(companyId)) {
    return res.status(400).json({ error: 'companyId inválido' });
  }
  if (!canWrite(req.user, req.companyId, companyId)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const bodySchema = z.object({
    email: z.string().email(),
    password: z.string().min(3),
    role: z.string().optional(), // 'user' | 'admin' | 'master' (evite 'master' aqui)
  });

  const parsed = bodySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password, role } = parsed.data;

  try {
    // Gere o hash NO BANCO com pgcrypto para manter compatível com dev.passtoken()
    // hash = crypt(password || '::company:' || companyId, gen_salt('bf', 12))
    const rHash = await query(
      `SELECT public.crypt($1 || '::company:' || $2::text, public.gen_salt('bf', 12)) AS hash`,
      [password, companyId]
    );
    const hash = rHash.rows[0]?.hash;
    if (!hash) return res.status(500).json({ error: 'Falha ao gerar hash' });

    const r = await query(
      `INSERT INTO ${schema}.users (email, password_hash, role, company_id, active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, email, role, active, company_id`,
      [String(email).trim().toLowerCase(), hash, role || 'user', companyId]
    );

    res.status(201).json(r.rows[0]);
  } catch (e) {
    // conflito de email (unique)
    if (String(e.message).includes('unique') || String(e.message).includes('duplicate key')) {
      return res.status(409).json({ error: 'Email já cadastrado' });
    }
    res.status(500).json({ error: e.message });
  }
});

/**
 * PUT /companies/:id/users/:userId
 * Atualiza role/active e (opcionalmente) reseta a senha
 * Body: { role?, active?, newPassword? }
 */
router.put('/:id/users/:userId', requireAuth, async (req, res) => {
  const companyId = Number(req.params.id);
  const userId = Number(req.params.userId);
  if (!Number.isFinite(companyId) || !Number.isFinite(userId)) {
    return res.status(400).json({ error: 'ids inválidos' });
  }
  if (!canWrite(req.user, req.companyId, companyId)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const bodySchema = z.object({
    role: z.string().optional(),
    active: z.boolean().optional(),
    newPassword: z.string().min(3).optional(),
  });
  const parsed = bodySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { role, active, newPassword } = parsed.data;

  try {
    // monta update dinamicamente
    const sets = [];
    const vals = [];
    let idx = 1;

    if (role) { sets.push(`role = $${idx++}`); vals.push(role); }
    if (typeof active === 'boolean') { sets.push(`active = $${idx++}`); vals.push(active); }

    if (newPassword) {
      // gera novo hash com pepper por empresa
      const rHash = await query(
        `SELECT public.crypt($1 || '::company:' || $2::text, public.gen_salt('bf', 12)) AS hash`,
        [newPassword, companyId]
      );
      const hash = rHash.rows[0]?.hash;
      if (!hash) return res.status(500).json({ error: 'Falha ao gerar hash' });
      sets.push(`password_hash = $${idx++}`);
      vals.push(hash);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Nada para atualizar' });
    }

    vals.push(userId, companyId);
    const r = await query(
      `UPDATE ${schema}.users
       SET ${sets.join(', ')}
       WHERE id = $${idx++} AND company_id = $${idx}
       RETURNING id, email, role, active, company_id`,
      vals
    );

    if (r.rowCount === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
