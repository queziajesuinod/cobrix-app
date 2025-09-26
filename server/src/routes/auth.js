// server/src/routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { z } = require('zod');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

// Assinatura padronizada do token
function sign(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      company_id: user.company_id ?? null,
    },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

// Middleware: exige token valido
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      company_id: payload.company_id ?? payload.companyId ?? null,
    };

    // 1a fonte: header X-Company-Id
    const hdr = req.header('x-company-id');

    // 2a fonte: fallback do proprio usuario (para user/admin)
    // master pode ficar sem companyId; rotas que exigem empresa validam depois
    req.companyId = hdr
      ? Number(hdr)
      : req.user.role === 'master'
      ? null
      : Number(req.user.company_id) || null;

    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Opcional: aceita token se vier, mas nao bloqueia
function maybeAuth(req, _res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = {
        id: payload.id,
        email: payload.email,
        role: payload.role,
        company_id: payload.company_id ?? payload.companyId ?? null,
      };
      const hdr = req.header('x-company-id');
      req.companyId = hdr
        ? Number(hdr)
        : req.user.role === 'master'
        ? null
        : Number(req.user.company_id) || null;
    } catch {
      // ignora erros de token aqui
    }
  }
  next();
}

// Helper multi-tenant
function companyScope(required = true) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Nao autenticado' });

    let companyId = null;
    if (req.user.role === 'master') {
      companyId = req.header('X-Company-Id') || req.query.companyId || null;
    } else {
      companyId = req.user.company_id;
    }

    if (required && !companyId) {
      return res
        .status(400)
        .json({ error: 'Selecione a empresa (X-Company-Id)' });
    }

    req.companyId = companyId ? Number(companyId) : null;
    next();
  };
}

// POST /auth/login
// Usa funcao SQL passtoken(email, password). Ela deve validar com pepper por empresa:
// u.password_hash = crypt(_password || '::company:' || u.company_id, u.password_hash)
// e pode manter compatibilidade com legado via OR crypt(_password, u.password_hash)
router.post('/login', async (req, res) => {
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
    const r = await query('SELECT * FROM passtoken($1,$2)', [email, password]);
    const user = r.rows[0];
    if (!user) return res.status(401).json({ error: 'Credenciais invalidas' });

    const token = sign(user);
    return res.json({ token, user });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /auth/verify
router.get('/verify', requireAuth, async (req, res) => {
  res.json({ ok: true, user: req.user });
});

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.companyScope = companyScope;
module.exports.maybeAuth = maybeAuth;
