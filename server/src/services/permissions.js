// server/src/services/permissions.js
// Motor de permissões: seed dos perfis-modelo, cálculo de permissões efetivas e
// middlewares de autorização (requirePermission / masterOnly).
const { query } = require('../db');
const { ALL_KEYS, SEED_PROFILES, isValidPermission } = require('../config/permissions-catalog');

const SCHEMA = process.env.DB_SCHEMA || 'public';

// Semeia os perfis-modelo na primeira execução (idempotente). Não re-sincroniza
// perfis existentes para não sobrescrever edições feitas pelo master.
async function seedPermissions() {
  const before = await query(`SELECT COUNT(*)::int AS n FROM ${SCHEMA}.profiles`);
  const firstRun = Number(before.rows[0]?.n || 0) === 0;

  for (const p of SEED_PROFILES) {
    const ins = await query(
      `INSERT INTO ${SCHEMA}.profiles (name, is_system) VALUES ($1,$2)
       ON CONFLICT (name) DO NOTHING RETURNING id`,
      [p.name, p.is_system]
    );
    const newId = ins.rows[0]?.id;
    if (newId) {
      for (const key of p.permissions) {
        await query(
          `INSERT INTO ${SCHEMA}.profile_permissions (profile_id, permission_key)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [newId, key]
        );
      }
    }
  }

  // Mantém o perfil de sistema "Administrador" sempre COMPLETO (todas as chaves
  // do catálogo) — assim, ao adicionar novas permissões (ex.: dados sensíveis),
  // o Administrador já as recebe. Não afeta perfis customizados.
  const admin = await query(`SELECT id FROM ${SCHEMA}.profiles WHERE name = 'Administrador' LIMIT 1`);
  const adminId = admin.rows[0]?.id;
  if (adminId) {
    for (const key of ALL_KEYS) {
      await query(
        `INSERT INTO ${SCHEMA}.profile_permissions (profile_id, permission_key)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [adminId, key]
      );
    }
  }

  // No primeiro boot, dá acesso total (perfil Administrador) aos usuários
  // existentes não-master — evita travar quem já usava o sistema.
  if (firstRun) {
    await query(
      `UPDATE ${SCHEMA}.users
          SET profile_id = (SELECT id FROM ${SCHEMA}.profiles WHERE name = 'Administrador' LIMIT 1)
        WHERE profile_id IS NULL AND role <> 'master'`
    );
  }
}

// Permissões efetivas de um usuário: master = tudo; demais = perfil ∪ grants − revokes.
async function getEffectivePermissions(user) {
  if (!user) return [];
  if (user.role === 'master') return [...ALL_KEYS];

  const profilePerms = await query(
    `SELECT pp.permission_key
       FROM ${SCHEMA}.profile_permissions pp
       JOIN ${SCHEMA}.users u ON u.profile_id = pp.profile_id
      WHERE u.id = $1`,
    [user.id]
  );
  const overrides = await query(
    `SELECT permission_key, allowed FROM ${SCHEMA}.user_permission_overrides WHERE user_id = $1`,
    [user.id]
  );

  const set = new Set(profilePerms.rows.map((r) => r.permission_key));
  for (const o of overrides.rows) {
    if (o.allowed) set.add(o.permission_key);
    else set.delete(o.permission_key);
  }
  // Filtra por chaves válidas do catálogo (limpa chaves obsoletas).
  return [...set].filter(isValidPermission);
}

// Middleware: exige uma permissão específica (master sempre passa).
function requirePermission(key) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
      if (req.user.role === 'master') return next();
      const perms = await getEffectivePermissions(req.user);
      if (perms.includes(key)) return next();
      return res.status(403).json({ error: 'Acesso negado: sem permissão para esta ação.' });
    } catch (e) {
      next(e);
    }
  };
}

// Middleware: exige papel master.
function masterOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
  if (req.user.role !== 'master') return res.status(403).json({ error: 'Apenas master' });
  next();
}

module.exports = { seedPermissions, getEffectivePermissions, requirePermission, masterOnly };
