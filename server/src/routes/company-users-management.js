const express = require("express");
const { query } = require("../db");
const { requireAuth } = require("./auth");

const router = express.Router();

function isMaster(user) { 
  return user?.role === "master"; 
}

function canManageCompany(user, companyId) {
  if (!user) return false;
  if (isMaster(user)) {
    return user.company_ids.includes(Number(companyId));
  }
  // Usuários admin podem gerenciar usuários da própria empresa
  if (user?.role === "admin") {
    return user.company_ids.includes(Number(companyId));
  }
  return false;
}

// Validação simples
function validateCreateUser(data) {
  const { email, password, role, active } = data || {};
  
  if (!email || !email.includes('@')) {
    return { error: "Email inválido" };
  }
  
  if (password != null && password !== '' && password.length < 6) {
    return { error: "Senha deve ter pelo menos 6 caracteres" };
  }
  
  if (!role || !['user', 'admin'].includes(role)) {
    return { error: "Role deve ser 'user' ou 'admin'" };
  }
  
  return { 
    data: { 
      email, 
      password: password || null, 
      role, 
      active: active !== undefined ? active : true 
    } 
  };
}

function validateUpdateUser(data) {
  const { email, password, role, active } = data || {};
  const result = {};
  
  if (email !== undefined) {
    if (!email.includes('@')) {
      return { error: "Email inválido" };
    }
    result.email = email;
  }
  
  if (password !== undefined) {
    if (password.length < 6) {
      return { error: "Senha deve ter pelo menos 6 caracteres" };
    }
    result.password = password;
  }
  
  if (role !== undefined) {
    if (!['user', 'admin'].includes(role)) {
      return { error: "Role deve ser 'user' ou 'admin'" };
    }
    result.role = role;
  }
  
  if (active !== undefined) {
    result.active = active;
  }
  
  return { data: result };
}

// GET /api/companies/:companyId/users - Listar usuários da empresa
router.get("/:companyId/users", requireAuth, async (req, res) => {
  try {
    const companyId = Number(req.params.companyId);
    
    if (!canManageCompany(req.user, companyId)) {
      return res.status(403).json({ error: "Sem permissão para gerenciar usuários desta empresa" });
    }

    // Verificar se a empresa existe
    const companyCheck = await query("SELECT id FROM companies WHERE id = $1", [companyId]);
    if (!companyCheck.rows[0]) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    // Buscar usuários da empresa
    const result = await query(`
      SELECT 
        u.id, 
        u.email, 
        u.role, 
        u.active, 
        u.created_at,
        c.name as company_name
      FROM users u
      JOIN user_companies uc ON u.id = uc.user_id
      JOIN companies c ON uc.company_id = c.id
      WHERE uc.company_id = $1
      ORDER BY u.created_at DESC
    `, [companyId]);

    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao listar usuários da empresa:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// POST /api/companies/:companyId/users - Criar usuário para a empresa
router.post("/:companyId/users", requireAuth, async (req, res) => {
  try {
    const companyId = Number(req.params.companyId);
    
    if (!canManageCompany(req.user, companyId)) {
      return res.status(403).json({ error: "Sem permissão para criar usuários nesta empresa" });
    }

    // Validar dados de entrada
    const validation = validateCreateUser(req.body);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const { email, password, role, active } = validation.data;

    // Verificar se a empresa existe
    const companyCheck = await query("SELECT id FROM companies WHERE id = $1", [companyId]);
    if (!companyCheck.rows[0]) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const existingUser = await query("SELECT id, role, active FROM users WHERE email = $1", [email]);
    let targetUserId;

    if (existingUser.rows[0]) {
      targetUserId = existingUser.rows[0].id;

      // Verificar se já está associado
      const alreadyLinked = await query(`
        SELECT 1 FROM user_companies WHERE user_id = $1 AND company_id = $2
      `, [targetUserId, companyId]);
      if (alreadyLinked.rows[0]) {
        return res.status(409).json({ error: "Usuário já vinculado a esta empresa" });
      }

      await query(`
        INSERT INTO user_companies (user_id, company_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [targetUserId, companyId]);
    } else {
      if (!password) {
        return res.status(400).json({ error: "Senha obrigatória para novos usuários" });
      }

      const userResult = await query(`
        INSERT INTO users (email, password_hash, role, active, created_at)
        VALUES ($1, public.crypt($2, public.gen_salt('bf')), $3, $4, now())
        RETURNING id, email, role, active, created_at
      `, [email, password, role, active]);

      const newUser = userResult.rows[0];
      targetUserId = newUser.id;

      await query(`
        INSERT INTO user_companies (user_id, company_id)
        VALUES ($1, $2)
      `, [targetUserId, companyId]);
    }

    // Buscar dados completos do usuário criado
    const fullUserResult = await query(`
      SELECT 
        u.id, 
        u.email, 
        u.role, 
        u.active, 
        u.created_at,
        c.name as company_name
      FROM users u
      JOIN user_companies uc ON u.id = uc.user_id
      JOIN companies c ON uc.company_id = c.id
      WHERE u.id = $1 AND uc.company_id = $2
    `, [targetUserId, companyId]);

    res.status(201).json(fullUserResult.rows[0]);
  } catch (error) {
    console.error("Erro ao criar usuário:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// GET /api/companies/:companyId/users/:userId - Obter usuário específico
router.get("/:companyId/users/:userId", requireAuth, async (req, res) => {
  try {
    const companyId = Number(req.params.companyId);
    const userId = Number(req.params.userId);
    
    if (!canManageCompany(req.user, companyId)) {
      return res.status(403).json({ error: "Sem permissão para acessar usuários desta empresa" });
    }

    const result = await query(`
      SELECT 
        u.id, 
        u.email, 
        u.role, 
        u.active, 
        u.created_at,
        c.name as company_name
      FROM users u
      JOIN user_companies uc ON u.id = uc.user_id
      JOIN companies c ON uc.company_id = c.id
      WHERE u.id = $1 AND uc.company_id = $2
    `, [userId, companyId]);

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Usuário não encontrado nesta empresa" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Erro ao buscar usuário:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// PUT /api/companies/:companyId/users/:userId - Atualizar usuário
router.put("/:companyId/users/:userId", requireAuth, async (req, res) => {
  try {
    const companyId = Number(req.params.companyId);
    const userId = Number(req.params.userId);
    
    if (!canManageCompany(req.user, companyId)) {
      return res.status(403).json({ error: "Sem permissão para editar usuários desta empresa" });
    }

    // Validar dados de entrada
    const validation = validateUpdateUser(req.body);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const updateData = validation.data;

    // Verificar se o usuário existe na empresa
    const userCheck = await query(`
      SELECT u.id FROM users u
      JOIN user_companies uc ON u.id = uc.user_id
      WHERE u.id = $1 AND uc.company_id = $2
    `, [userId, companyId]);

    if (!userCheck.rows[0]) {
      return res.status(404).json({ error: "Usuário não encontrado nesta empresa" });
    }

    // Se está alterando email, verificar se não existe
    if (updateData.email) {
      const emailCheck = await query("SELECT id FROM users WHERE email = $1 AND id != $2", [updateData.email, userId]);
      if (emailCheck.rows[0]) {
        return res.status(409).json({ error: "Email já está em uso" });
      }
    }

    // Construir query de atualização dinamicamente
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (updateData.email) {
      updateFields.push(`email = $${paramCount}`);
      updateValues.push(updateData.email);
      paramCount++;
    }

    if (updateData.password) {
      updateFields.push(`password_hash = public.crypt($${paramCount}, public.gen_salt('bf'))`);
      updateValues.push(updateData.password);
      paramCount++;
    }

    if (updateData.role !== undefined) {
      updateFields.push(`role = $${paramCount}`);
      updateValues.push(updateData.role);
      paramCount++;
    }

    if (updateData.active !== undefined) {
      updateFields.push(`active = $${paramCount}`);
      updateValues.push(updateData.active);
      paramCount++;
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: "Nenhum campo para atualizar" });
    }

    // Adicionar WHERE clause
    updateValues.push(userId);
    const whereClause = `$${paramCount}`;

    const updateQuery = `
      UPDATE users 
      SET ${updateFields.join(', ')}
      WHERE id = ${whereClause}
      RETURNING id, email, role, active, created_at
    `;

    const result = await query(updateQuery, updateValues);

    // Buscar dados completos do usuário atualizado
    const fullUserResult = await query(`
      SELECT 
        u.id, 
        u.email, 
        u.role, 
        u.active, 
        u.created_at,
        c.name as company_name
      FROM users u
      JOIN user_companies uc ON u.id = uc.user_id
      JOIN companies c ON uc.company_id = c.id
      WHERE u.id = $1 AND uc.company_id = $2
    `, [userId, companyId]);

    res.json(fullUserResult.rows[0]);
  } catch (error) {
    console.error("Erro ao atualizar usuário:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// DELETE /api/companies/:companyId/users/:userId - Remover usuário da empresa
router.delete("/:companyId/users/:userId", requireAuth, async (req, res) => {
  try {
    const companyId = Number(req.params.companyId);
    const userId = Number(req.params.userId);
    
    if (!canManageCompany(req.user, companyId)) {
      return res.status(403).json({ error: "Sem permissão para remover usuários desta empresa" });
    }

    // Verificar se o usuário existe na empresa
    const userCheck = await query(`
      SELECT u.id, u.email FROM users u
      JOIN user_companies uc ON u.id = uc.user_id
      WHERE u.id = $1 AND uc.company_id = $2
    `, [userId, companyId]);

    if (!userCheck.rows[0]) {
      return res.status(404).json({ error: "Usuário não encontrado nesta empresa" });
    }

    // Não permitir remover o próprio usuário
    if (userId === req.user.id) {
      return res.status(400).json({ error: "Não é possível remover seu próprio usuário" });
    }

    // Remover associação da empresa
    await query("DELETE FROM user_companies WHERE user_id = $1 AND company_id = $2", [userId, companyId]);

    // Verificar se o usuário ainda está associado a outras empresas
    const otherAssociations = await query("SELECT company_id FROM user_companies WHERE user_id = $1", [userId]);

    // Se não está associado a nenhuma empresa, remover o usuário completamente
    if (otherAssociations.rows.length === 0) {
      await query("DELETE FROM users WHERE id = $1", [userId]);
    }

    res.json({ 
      ok: true, 
      message: "Usuário removido da empresa com sucesso",
      user_deleted: otherAssociations.rows.length === 0
    });
  } catch (error) {
    console.error("Erro ao remover usuário:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

module.exports = router;
