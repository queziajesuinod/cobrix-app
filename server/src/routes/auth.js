const express = require("express");
const jwt = require("jsonwebtoken");
const { query } = require("../db");
const { z } = require("zod");
const { respondError } = require("../utils/http-error");

const router = express.Router();
// Segredos placeholder conhecidos: em produção o boot deve falhar se o
// JWT_SECRET estiver ausente OU for um destes valores públicos.
const PLACEHOLDER_JWT_SECRETS = new Set([
  'change-me-dev-secret',
  'devsecret-apenas-desenvolvimento',
]);
const JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === 'production';
  if (!secret || PLACEHOLDER_JWT_SECRETS.has(secret)) {
    if (isProd) {
      console.error('[FATAL] JWT_SECRET ausente ou usando um valor placeholder inseguro. Defina um segredo forte e único no .env antes de iniciar em produção.');
      process.exit(1);
    }
    return 'devsecret-apenas-desenvolvimento';
  }
  return secret;
})();

// Assinatura padronizada do token
async function sign(user) {
  // Usar company_ids já fornecidas pelo objeto user
  const companyIds = user.company_ids || [];

  const tokenPayload = {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    role: user.role,
    company_ids: companyIds,
  };
  
  return jwt.sign(
    tokenPayload,
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

// Middleware: exige token valido
async function masterHasCompany(userId, companyId) {
  if (!userId || !companyId) return false;
  const r = await query(
    `SELECT 1 FROM user_companies WHERE user_id=$1 AND company_id=$2`,
    [userId, companyId]
  );
  return r.rowCount > 0;
}

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    req.user = {
      id: payload.id,
      email: payload.email,
      name: payload.name ?? null,
      role: payload.role,
      company_ids: payload.company_ids || [], // Agora é um array
    };

    const hdr = req.header("x-company-id");
    let requestedCompanyId = hdr ? Number(hdr) : null;

    if (req.user.role === "master") {
      if (requestedCompanyId) {
        if (!req.user.company_ids.includes(requestedCompanyId)) {
          const hasAccess = await masterHasCompany(req.user.id, requestedCompanyId);
          if (!hasAccess) {
            return res.status(403).json({ error: "Acesso negado à empresa solicitada" });
          }
          req.user.company_ids.push(requestedCompanyId);
        }
        req.companyId = requestedCompanyId;
      } else {
        req.companyId = null;
      }
    } else {
      // Usuários normais só podem acessar empresas às quais estão vinculados.
      if (req.user.company_ids.length === 0) {
        return res.status(403).json({ error: "Usuário não vinculado a nenhuma empresa" });
      }
      if (requestedCompanyId && !req.user.company_ids.includes(requestedCompanyId)) {
        return res.status(403).json({ error: "Acesso negado à empresa solicitada" });
      }
      // Quando vinculado a mais de uma empresa, honra a empresa selecionada
      // (X-Company-Id) desde que seja uma das suas; senão usa a primeira.
      req.companyId = requestedCompanyId && req.user.company_ids.includes(requestedCompanyId)
        ? requestedCompanyId
        : req.user.company_ids[0];
    }

    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Opcional: aceita token se vier, mas não bloqueia
async function maybeAuth(req, _res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      req.user = {
        id: payload.id,
        email: payload.email,
        name: payload.name ?? null,
        role: payload.role,
        company_ids: payload.company_ids || [],
      };
      const hdr = req.header("x-company-id");
      let requestedCompanyId = hdr ? Number(hdr) : null;

      if (req.user.role === "master") {
        if (requestedCompanyId && !req.user.company_ids.includes(requestedCompanyId)) {
          req.companyId = null; // Não permite acesso, mas não bloqueia a rota
        } else {
          req.companyId = requestedCompanyId;
        }
      } else {
        if (req.user.company_ids.length === 0) {
          req.companyId = null;
        } else if (requestedCompanyId && !req.user.company_ids.includes(requestedCompanyId)) {
          req.companyId = null;
        } else {
          req.companyId = requestedCompanyId && req.user.company_ids.includes(requestedCompanyId)
            ? requestedCompanyId
            : req.user.company_ids[0];
        }
      }
    } catch {
      // ignora erros de token aqui
    }
  }
  next();
}

// Helper multi-tenant
function companyScope(required = true) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Não autenticado" });

    let companyId = null;
    if (req.user.role === "master") {
      companyId = req.header("X-Company-Id") || req.query.companyId || null;
      if (companyId && !req.user.company_ids.includes(Number(companyId))) {
        return res.status(403).json({ error: "Acesso negado à empresa solicitada" });
      }
    } else {
      if (req.user.company_ids.length === 0) {
        return res.status(403).json({ error: "Usuário não vinculado a nenhuma empresa" });
      }
      const requested = req.header("X-Company-Id") || req.query.companyId || null;
      if (requested && !req.user.company_ids.includes(Number(requested))) {
        return res.status(403).json({ error: "Acesso negado à empresa solicitada" });
      }
      companyId = requested ? Number(requested) : req.user.company_ids[0];
    }

    if (required && !companyId) {
      return res
        .status(400)
        .json({ error: "Selecione a empresa (X-Company-Id)" });
    }

    req.companyId = companyId ? Number(companyId) : null;
    next();
  };
}

// POST /auth/login
router.post("/login", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(3),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  try {
    // A função passtoken agora precisa retornar o user.id e o role, mas não o company_id
    // pois o company_id será buscado separadamente para usuários master.
    // Para usuários não-master, ainda pode retornar um company_id principal.
    const r = await query(
      `SELECT u.id, u.email, u.name, u.role, uc.company_id
       FROM users u
       LEFT JOIN user_companies uc ON u.id = uc.user_id
       WHERE u.email = $1 AND u.password_hash = public.crypt($2, u.password_hash)
         AND u.active = true`,
      [email, password]
    );

    if (r.rows.length === 0) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    // Reconstruir o objeto user com todas as company_ids
    const companyIds = r.rows.map(row => row.company_id).filter(id => id !== null);
    
    const user = {
      id: r.rows[0].id,
      email: r.rows[0].email,
      name: r.rows[0].name ?? null,
      role: r.rows[0].role,
      company_ids: companyIds
    };

    // Gate da assinatura (SaaS): usuário não-master só entra se ao menos uma de
    // suas empresas estiver ativa. Empresas de inscrição nascem 'pending_payment'
    // e só liberam o acesso quando o PIX é confirmado (webhook ativa). Empresas
    // antigas têm status 'active' (default), então não são afetadas.
    if (user.role !== 'master' && companyIds.length > 0) {
      const cs = await query(`SELECT status FROM companies WHERE id = ANY($1::int[])`, [companyIds]);
      const statuses = cs.rows.map((row) => row.status);
      const hasActive = statuses.some((s) => !s || s === 'active');
      if (!hasActive) {
        const pending = statuses.includes('pending_payment');
        return res.status(403).json({
          error: pending
            ? 'Sua conta está aguardando a confirmação do pagamento. Assim que o PIX for compensado, o acesso é liberado automaticamente.'
            : 'Sua assinatura está suspensa. Regularize o pagamento para reativar o acesso.',
        });
      }
    }

    const token = await sign(user);
    return res.json({ token, user });
  } catch (err) {
    return respondError(res, err);
  }
});

// GET /auth/verify
router.get("/verify", requireAuth, async (req, res) => {
  res.json({ ok: true, user: req.user });
});

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.companyScope = companyScope;
module.exports.maybeAuth = maybeAuth;
