const express = require("express");
const jwt = require("jsonwebtoken");
const { query } = require("../db");
const { z } = require("zod");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

// Assinatura padronizada do token
async function sign(user) {
  let companyIds = [];
  if (user.role === "master") {
    const r = await query(
      `SELECT company_id FROM user_companies WHERE user_id = $1`,
      [user.id]
    );
    companyIds = r.rows.map((row) => row.company_id);
  } else if (user.company_id) {
    companyIds = [user.company_id];
  }

  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      company_ids: companyIds, // Agora armazena um array de IDs de empresas
    },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

// Middleware: exige token valido
async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      company_ids: payload.company_ids || [], // Agora é um array
    };

    const hdr = req.header("x-company-id");
    let requestedCompanyId = hdr ? Number(hdr) : null;

    if (req.user.role === "master") {
      // Master pode acessar qualquer empresa que esteja vinculada
      if (requestedCompanyId && !req.user.company_ids.includes(requestedCompanyId)) {
        return res.status(403).json({ error: "Acesso negado à empresa solicitada" });
      }
      req.companyId = requestedCompanyId; // Master pode selecionar a empresa via header
    } else {
      // Usuários normais só podem acessar a empresa a que estão vinculados
      if (req.user.company_ids.length === 0) {
        return res.status(403).json({ error: "Usuário não vinculado a nenhuma empresa" });
      }
      if (requestedCompanyId && !req.user.company_ids.includes(requestedCompanyId)) {
        return res.status(403).json({ error: "Acesso negado à empresa solicitada" });
      }
      req.companyId = req.user.company_ids[0]; // Usuário normal tem uma única empresa principal
    }

    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Opcional: aceita token se vier, mas nao bloqueia
async function maybeAuth(req, _res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = {
        id: payload.id,
        email: payload.email,
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
          req.companyId = req.user.company_ids[0];
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
    if (!req.user) return res.status(401).json({ error: "Nao autenticado" });

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
      companyId = req.user.company_ids[0];
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
      `SELECT u.id, u.email, u.role, uc.company_id
       FROM users u
       LEFT JOIN user_companies uc ON u.id = uc.user_id
       WHERE u.email = $1 AND u.password_hash = public.crypt($2, u.password_hash)`,
      [email, password]
    );

    if (r.rows.length === 0) {
      return res.status(401).json({ error: "Credenciais invalidas" });
    }

    // Reconstruir o objeto user com todas as company_ids se for master
    const user = {
      id: r.rows[0].id,
      email: r.rows[0].email,
      role: r.rows[0].role,
      company_ids: r.rows.map(row => row.company_id).filter(id => id !== null) // Coleta todas as company_ids
    };

    const token = await sign(user);
    return res.json({ token, user });
  } catch (err) {
    return res.status(500).json({ error: err.message });
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
