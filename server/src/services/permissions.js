// server/src/services/permissions.js
// Motor de permissões: seed dos perfis-modelo, cálculo de permissões efetivas e
// middlewares de autorização (requirePermission / masterOnly).
const { query } = require('../db');
const { ALL_KEYS, SEED_PROFILES, isValidPermission, LEGACY_TASKS_MANAGE, TASKS_MANAGE_SPLIT } = require('../config/permissions-catalog');

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

  // Migração: o antigo `tasks.manage` (permissão única do Gerenciador de Tarefas)
  // foi dividido em chaves granulares. Todo perfil e todo override de usuário que
  // concedia `tasks.manage` passa a conceder as novas chaves — assim ninguém perde
  // acesso ao dividir a permissão. Idempotente (ON CONFLICT/existência) e só age
  // enquanto houver linhas legadas de `tasks.manage`.
  await migrateTasksManageSplit();

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

// Divide o antigo `tasks.manage` nas permissões granulares (ver comentário na
// chamada). Copia o grant para cada perfil que tinha `tasks.manage` e para cada
// override de usuário que o permitia (allowed=true). Não remove o `tasks.manage`
// legado (fica inerte: sai do catálogo e é filtrado em getEffectivePermissions).
async function migrateTasksManageSplit() {
  // Perfis com tasks.manage → recebem as novas chaves.
  const profs = await query(
    `SELECT DISTINCT profile_id FROM ${SCHEMA}.profile_permissions WHERE permission_key = $1`,
    [LEGACY_TASKS_MANAGE]
  );
  for (const p of profs.rows) {
    for (const key of TASKS_MANAGE_SPLIT) {
      await query(
        `INSERT INTO ${SCHEMA}.profile_permissions (profile_id, permission_key)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [p.profile_id, key]
      );
    }
  }
  // Overrides de usuário que PERMITIAM tasks.manage → replica o allow para as novas
  // chaves (só se ainda não houver override daquela chave, para não sobrescrever um
  // revoke intencional que o master já tenha feito nas novas chaves).
  const ovr = await query(
    `SELECT user_id FROM ${SCHEMA}.user_permission_overrides WHERE permission_key = $1 AND allowed = true`,
    [LEGACY_TASKS_MANAGE]
  );
  for (const o of ovr.rows) {
    for (const key of TASKS_MANAGE_SPLIT) {
      await query(
        `INSERT INTO ${SCHEMA}.user_permission_overrides (user_id, permission_key, allowed)
         VALUES ($1,$2,true) ON CONFLICT DO NOTHING`,
        [o.user_id, key]
      );
    }
  }
  // Teto de plano: planos que liberavam tasks.manage passam a liberar as novas chaves
  // (senão a interseção do teto zeraria o acesso, pois tasks.manage saiu do catálogo).
  // Guardado por try/catch para não travar o boot caso a tabela plans não exista ainda.
  try {
    const plans = await query(
      `SELECT id, permission_keys FROM ${SCHEMA}.plans WHERE $1 = ANY(permission_keys)`,
      [LEGACY_TASKS_MANAGE]
    );
    for (const pl of plans.rows) {
      const cur = new Set(Array.isArray(pl.permission_keys) ? pl.permission_keys : []);
      const missing = TASKS_MANAGE_SPLIT.filter((k) => !cur.has(k));
      if (missing.length) {
        await query(
          `UPDATE ${SCHEMA}.plans SET permission_keys = permission_keys || $2::text[], updated_at = now() WHERE id = $1`,
          [pl.id, missing]
        );
      }
    }
  } catch (e) {
    console.error('[permissions] migração de planos (tasks.manage) falhou:', e.message);
  }
}

// Teto de acesso do PLANO da empresa (camada 1 do modelo de 2 camadas).
// Retorna um Set com as chaves permitidas pelo plano, ou `null` quando não há
// teto — empresa sem plano (ou plano sem chaves) = acesso total, para não
// afetar empresas já existentes. Falha "aberta" (null) em caso de erro para
// nunca trancar o acesso por um problema de infraestrutura — o teto só restringe.
async function getCompanyCeiling(companyId) {
  if (!companyId) return null;
  try {
    const r = await query(
      `SELECT pl.permission_keys
         FROM ${SCHEMA}.companies c
         JOIN ${SCHEMA}.plans pl ON pl.id = c.plan_id
        WHERE c.id = $1`,
      [companyId]
    );
    const row = r.rows[0];
    if (!row) return null; // empresa sem plano → sem teto
    const keys = Array.isArray(row.permission_keys) ? row.permission_keys : [];
    if (keys.length === 0) return null; // plano sem chaves definidas → sem teto
    return new Set(keys.filter(isValidPermission));
  } catch {
    return null;
  }
}

// Permissões efetivas de um usuário: master = tudo; demais = (perfil ∪ grants −
// revokes) ∩ teto-do-plano-da-empresa. `companyId` define qual empresa (e, logo,
// qual teto) aplicar; se omitido, usa a empresa principal do token.
// Permissões transversais que NÃO são cortadas pelo teto do plano (capacidades
// liberadas por outra dimensão — ex.: revenda pela flag is_partner da empresa).
const CEILING_EXEMPT = new Set(['partner.portal.view']);

async function getEffectivePermissions(user, companyId) {
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
  let effective = [...set].filter(isValidPermission);

  // Camada 1: aplica o teto do plano da empresa (interseção). Algumas permissões
  // são TRANSVERSAIS (não são módulos de plano) e não devem ser cortadas pelo teto —
  // ex.: o portal de revenda, liberado pela flag is_partner da empresa, não por plano.
  const cid = companyId ?? (Array.isArray(user.company_ids) ? user.company_ids[0] : null);
  const ceiling = await getCompanyCeiling(cid);
  if (ceiling) effective = effective.filter((k) => ceiling.has(k) || CEILING_EXEMPT.has(k));
  return effective;
}

// Middleware: exige uma permissão específica (master sempre passa).
function requirePermission(key) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
      if (req.user.role === 'master') return next();
      const perms = await getEffectivePermissions(req.user, req.companyId);
      if (perms.includes(key)) return next();
      return res.status(403).json({ error: 'Acesso negado: sem permissão para esta ação.' });
    } catch (e) {
      next(e);
    }
  };
}

// Middleware: exige QUALQUER UMA das permissões (master sempre passa).
function requireAnyPermission(keys) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
      if (req.user.role === 'master') return next();
      const perms = await getEffectivePermissions(req.user, req.companyId);
      if (keys.some((k) => perms.includes(k))) return next();
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

module.exports = { seedPermissions, getEffectivePermissions, getCompanyCeiling, requirePermission, requireAnyPermission, masterOnly };
