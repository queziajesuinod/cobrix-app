const express = require('express');
const { query, withClient } = require('../db');
const { requireAuth, companyScope } = require('./auth');
const { masterOnly, getEffectivePermissions, requirePermission } = require('../services/permissions');
const { CATALOG, isValidPermission } = require('../config/permissions-catalog');
const { respondError } = require('../utils/http-error');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const router = express.Router();

// Permissões efetivas do usuário logado (usado pelo frontend para gating).
router.get('/me', requireAuth, async (req, res) => {
  try {
    const permissions = await getEffectivePermissions(req.user);
    res.json({ role: req.user.role, permissions });
  } catch (e) { respondError(res, e); }
});

// Catálogo de permissões (para a matriz de perfis). Master.
router.get('/catalog', requireAuth, masterOnly, (_req, res) => {
  res.json({ catalog: CATALOG });
});

// ---- Perfis (master) ----
router.get('/profiles', requireAuth, masterOnly, async (_req, res) => {
  try {
    const r = await query(
      `SELECT p.id, p.name, p.is_system,
              (SELECT COUNT(*)::int FROM ${SCHEMA}.profile_permissions pp WHERE pp.profile_id = p.id) AS permission_count,
              (SELECT COUNT(*)::int FROM ${SCHEMA}.users u WHERE u.profile_id = p.id) AS user_count
         FROM ${SCHEMA}.profiles p
        ORDER BY p.is_system DESC, p.name ASC`
    );
    res.json({ profiles: r.rows });
  } catch (e) { respondError(res, e); }
});

router.get('/profiles/:id', requireAuth, masterOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const p = await query(`SELECT id, name, is_system FROM ${SCHEMA}.profiles WHERE id = $1`, [id]);
    if (!p.rows[0]) return res.status(404).json({ error: 'Perfil não encontrado' });
    const perms = await query(`SELECT permission_key FROM ${SCHEMA}.profile_permissions WHERE profile_id = $1`, [id]);
    res.json({ ...p.rows[0], permissions: perms.rows.map((r) => r.permission_key) });
  } catch (e) { respondError(res, e); }
});

router.post('/profiles', requireAuth, masterOnly, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (name.length < 2) return res.status(400).json({ error: 'Nome do perfil obrigatório' });
    const r = await query(
      `INSERT INTO ${SCHEMA}.profiles (name, is_system) VALUES ($1, false) RETURNING id, name, is_system`,
      [name]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (String(e.message).includes('duplicate key')) return res.status(409).json({ error: 'Já existe um perfil com esse nome' });
    respondError(res, e);
  }
});

router.put('/profiles/:id', requireAuth, masterOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body?.name || '').trim();
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    if (name.length < 2) return res.status(400).json({ error: 'Nome do perfil obrigatório' });
    const r = await query(`UPDATE ${SCHEMA}.profiles SET name = $1 WHERE id = $2 RETURNING id, name, is_system`, [name, id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Perfil não encontrado' });
    res.json(r.rows[0]);
  } catch (e) {
    if (String(e.message).includes('duplicate key')) return res.status(409).json({ error: 'Já existe um perfil com esse nome' });
    respondError(res, e);
  }
});

// Substitui o conjunto de permissões do perfil.
router.put('/profiles/:id/permissions', requireAuth, masterOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const incoming = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    const keys = [...new Set(incoming.map(String))].filter(isValidPermission);

    const exists = await query(`SELECT 1 FROM ${SCHEMA}.profiles WHERE id = $1`, [id]);
    if (!exists.rowCount) return res.status(404).json({ error: 'Perfil não encontrado' });

    await withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(`DELETE FROM ${SCHEMA}.profile_permissions WHERE profile_id = $1`, [id]);
        for (const key of keys) {
          await client.query(
            `INSERT INTO ${SCHEMA}.profile_permissions (profile_id, permission_key) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [id, key]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
    res.json({ ok: true, permissions: keys });
  } catch (e) { respondError(res, e); }
});

router.delete('/profiles/:id', requireAuth, masterOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const p = await query(`SELECT is_system FROM ${SCHEMA}.profiles WHERE id = $1`, [id]);
    if (!p.rows[0]) return res.status(404).json({ error: 'Perfil não encontrado' });
    if (p.rows[0].is_system) return res.status(409).json({ error: 'Perfis do sistema não podem ser excluídos' });
    const used = await query(`SELECT COUNT(*)::int AS n FROM ${SCHEMA}.users WHERE profile_id = $1`, [id]);
    if (Number(used.rows[0].n) > 0) return res.status(409).json({ error: 'Perfil em uso por usuários. Reatribua-os antes de excluir.' });
    await query(`DELETE FROM ${SCHEMA}.profiles WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// ---- Usuários (master) ----
router.get('/users', requireAuth, masterOnly, async (_req, res) => {
  try {
    const r = await query(
      `SELECT u.id, u.email, u.name, u.role, u.active, u.profile_id, p.name AS profile_name
         FROM ${SCHEMA}.users u
         LEFT JOIN ${SCHEMA}.profiles p ON p.id = u.profile_id
        ORDER BY u.email ASC`
    );
    res.json({ users: r.rows });
  } catch (e) { respondError(res, e); }
});

router.put('/users/:id/profile', requireAuth, masterOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const raw = req.body?.profileId;
    const profileId = raw == null || raw === '' ? null : Number(raw);
    if (profileId != null && !Number.isInteger(profileId)) return res.status(400).json({ error: 'profileId inválido' });
    if (profileId != null) {
      const ok = await query(`SELECT 1 FROM ${SCHEMA}.profiles WHERE id = $1`, [profileId]);
      if (!ok.rowCount) return res.status(404).json({ error: 'Perfil não encontrado' });
    }
    const r = await query(`UPDATE ${SCHEMA}.users SET profile_id = $1 WHERE id = $2 RETURNING id, profile_id`, [profileId, id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

router.get('/users/:id/overrides', requireAuth, masterOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const r = await query(`SELECT permission_key, allowed FROM ${SCHEMA}.user_permission_overrides WHERE user_id = $1`, [id]);
    res.json({ overrides: r.rows });
  } catch (e) { respondError(res, e); }
});

// Substitui todos os overrides do usuário. overrides: [{ key, allowed }]
router.put('/users/:id/overrides', requireAuth, masterOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const exists = await query(`SELECT 1 FROM ${SCHEMA}.users WHERE id = $1`, [id]);
    if (!exists.rowCount) return res.status(404).json({ error: 'Usuário não encontrado' });

    const incoming = Array.isArray(req.body?.overrides) ? req.body.overrides : [];
    const rows = incoming
      .filter((o) => o && isValidPermission(String(o.key)) && typeof o.allowed === 'boolean')
      .map((o) => ({ key: String(o.key), allowed: o.allowed }));

    await withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(`DELETE FROM ${SCHEMA}.user_permission_overrides WHERE user_id = $1`, [id]);
        for (const o of rows) {
          await client.query(
            `INSERT INTO ${SCHEMA}.user_permission_overrides (user_id, permission_key, allowed)
             VALUES ($1,$2,$3) ON CONFLICT (user_id, permission_key) DO UPDATE SET allowed = EXCLUDED.allowed`,
            [id, o.key, o.allowed]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
    res.json({ ok: true, overrides: rows });
  } catch (e) { respondError(res, e); }
});

// ---- Gestão de usuários por quem tem permissão (ex.: perfil Administrador) ----
// Restrição: um criador não-master NÃO pode atribuir o perfil "Administrador"
// (só Operador / Somente leitura / perfis customizados não-admin).
async function assignableProfiles(user) {
  const all = await query(`SELECT id, name, is_system FROM ${SCHEMA}.profiles ORDER BY is_system DESC, name`);
  if (user.role === 'master') return all.rows;
  return all.rows.filter((p) => p.name !== 'Administrador');
}

router.get('/manage/assignable-profiles', requireAuth, companyScope(true), requirePermission('users.create'), async (req, res) => {
  try {
    res.json({ profiles: await assignableProfiles(req.user) });
  } catch (e) { respondError(res, e); }
});

// Lista usuários (não-master) da empresa atual.
router.get('/manage/users', requireAuth, companyScope(true), requirePermission('users.view'), async (req, res) => {
  try {
    const r = await query(
      `SELECT u.id, u.email, u.name, u.role, u.active, u.profile_id, p.name AS profile_name
         FROM ${SCHEMA}.users u
         JOIN ${SCHEMA}.user_companies uc ON uc.user_id = u.id
         LEFT JOIN ${SCHEMA}.profiles p ON p.id = u.profile_id
        WHERE uc.company_id = $1 AND u.role <> 'master'
        ORDER BY u.email ASC`,
      [req.companyId]
    );
    res.json({ users: r.rows });
  } catch (e) { respondError(res, e); }
});

// Carrega um usuário garantindo que o ator pode gerenciá-lo:
//  - pertence à empresa atual e não é master;
//  - se o ator NÃO é master, o alvo não pode ter o perfil Administrador.
async function loadManageableUser(actor, targetId, companyId) {
  const r = await query(
    `SELECT u.id, u.email, u.name, u.role, u.active, u.profile_id, p.name AS profile_name
       FROM ${SCHEMA}.users u
       JOIN ${SCHEMA}.user_companies uc ON uc.user_id = u.id
       LEFT JOIN ${SCHEMA}.profiles p ON p.id = u.profile_id
      WHERE u.id = $1 AND uc.company_id = $2`,
    [targetId, companyId]
  );
  const u = r.rows[0];
  if (!u) { const e = new Error('Usuário não encontrado nesta empresa'); e.status = 404; throw e; }
  if (u.role === 'master') { const e = new Error('Não é permitido gerenciar um usuário master'); e.status = 403; throw e; }
  if (actor.role !== 'master' && u.profile_name === 'Administrador') {
    const e = new Error('Você não pode gerenciar um usuário Administrador'); e.status = 403; throw e;
  }
  return u;
}

// Troca o perfil de um usuário (restrito aos perfis atribuíveis).
router.put('/manage/users/:id/profile', requireAuth, companyScope(true), requirePermission('users.create'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    await loadManageableUser(req.user, id, req.companyId);
    const raw = req.body?.profileId;
    const profileId = raw == null || raw === '' ? null : Number(raw);
    if (profileId != null) {
      if (!Number.isInteger(profileId)) return res.status(400).json({ error: 'profileId inválido' });
      const allowed = await assignableProfiles(req.user);
      if (!allowed.some((p) => p.id === profileId)) return res.status(403).json({ error: 'Você não pode atribuir este perfil.' });
    }
    const r = await query(`UPDATE ${SCHEMA}.users SET profile_id = $1 WHERE id = $2 RETURNING id, profile_id`, [profileId, id]);
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

// Ativa/desativa um usuário.
router.patch('/manage/users/:id/status', requireAuth, companyScope(true), requirePermission('users.create'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    if (id === req.user.id) return res.status(400).json({ error: 'Você não pode alterar o seu próprio status' });
    await loadManageableUser(req.user, id, req.companyId);
    const active = Boolean(req.body?.active);
    const r = await query(`UPDATE ${SCHEMA}.users SET active = $1 WHERE id = $2 RETURNING id, active`, [active, id]);
    res.json(r.rows[0]);
  } catch (e) { respondError(res, e); }
});

// Edita nome e (opcionalmente) redefine a senha.
router.put('/manage/users/:id', requireAuth, companyScope(true), requirePermission('users.create'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    await loadManageableUser(req.user, id, req.companyId);
    const name = String(req.body?.name || '').trim() || null;
    const password = req.body?.password != null ? String(req.body.password) : '';
    if (password && password.length < 6) return res.status(400).json({ error: 'A senha deve ter ao menos 6 caracteres' });
    if (password) {
      await query(
        `UPDATE ${SCHEMA}.users SET name = $1, password_hash = public.crypt($2, public.gen_salt('bf', 12)) WHERE id = $3`,
        [name, password, id]
      );
    } else {
      await query(`UPDATE ${SCHEMA}.users SET name = $1 WHERE id = $2`, [name, id]);
    }
    res.json({ ok: true });
  } catch (e) { respondError(res, e); }
});

// Cria um usuário (role 'user') na empresa atual, com um perfil permitido.
router.post('/manage/users', requireAuth, companyScope(true), requirePermission('users.create'), async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim() || null;
    const password = String(req.body?.password || '');
    const profileId = Number(req.body?.profileId);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido' });
    if (password.length < 6) return res.status(400).json({ error: 'A senha deve ter ao menos 6 caracteres' });
    if (!Number.isInteger(profileId)) return res.status(400).json({ error: 'Selecione um perfil' });

    const allowed = await assignableProfiles(req.user);
    if (!allowed.some((p) => p.id === profileId)) {
      return res.status(403).json({ error: 'Você não pode atribuir este perfil.' });
    }

    const created = await withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const ins = await client.query(
          `INSERT INTO ${SCHEMA}.users (email, password_hash, role, active, name, profile_id)
           VALUES ($1, public.crypt($2, public.gen_salt('bf', 12)), 'user', true, $3, $4)
           RETURNING id, email, name, role, profile_id`,
          [email, password, name, profileId]
        );
        const u = ins.rows[0];
        await client.query(
          `INSERT INTO ${SCHEMA}.user_companies (user_id, company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [u.id, req.companyId]
        );
        await client.query('COMMIT');
        return u;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
    res.status(201).json(created);
  } catch (e) {
    if (String(e.message).includes('duplicate key')) return res.status(409).json({ error: 'Já existe um usuário com este e-mail.' });
    respondError(res, e);
  }
});

module.exports = router;
