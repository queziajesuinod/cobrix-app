const express = require('express');
const { query } = require('../db');
const { z } = require('zod');
const { requireAuth, companyScope } = require('./auth');
const { assertClientLimit } = require('../utils/company-limits');

const router = express.Router();

const clientSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().email().optional().nullable(),
  phone: z.string().min(8).max(30).optional().nullable(),
  responsavel: z.string().trim().min(2),
  document: z.string().trim().optional().nullable(),
});

const normalizeEmail = (value) => {
  if (!value) return null;
  return String(value).trim().toLowerCase();
};

const normalizePhone = (value) => {
  if (!value) return null;
  return String(value).replace(/\D+/g, '');
};

function splitDocument(value) {
  if (value == null) return { cpf: null, cnpj: null };
  const digits = String(value).replace(/\D+/g, '');
  if (!digits) return { cpf: null, cnpj: null };
  if (digits.length === 11) return { cpf: digits, cnpj: null };
  if (digits.length === 14) return { cpf: null, cnpj: digits };
  const err = new Error('Documento deve ter 11 dígitos (CPF) ou 14 dígitos (CNPJ)');
  err.status = 400;
  throw err;
}

function attachDocument(row) {
  if (!row) return row;
  const document = row.document_cpf || row.document_cnpj || null;
  return { ...row, document };
}

async function ensureUniqueClientIdentifiers(companyId, { email, phone }, ignoreId) {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    const params = [companyId, normalizedEmail];
    let sql =
      'SELECT 1 FROM clients WHERE company_id=$1 AND email IS NOT NULL AND LOWER(email)=LOWER($2)';
    if (ignoreId) {
      params.push(ignoreId);
      sql += ' AND id <> $3';
    }
    const exists = await query(sql, params);
    if (exists.rowCount) {
      const err = new Error('Já existe um cliente cadastrado com este email');
      err.status = 409;
      throw err;
    }
  }

  // Permite o mesmo telefone para diferentes clientes/empresas
}

function normalizeStatus(raw) {
  const value = String(raw || 'active').toLowerCase();
  if (value === 'all' || value === 'inactive') return value;
  return 'active';
}

router.get('/', requireAuth, companyScope(true), async (req, res) => {
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);
  const q = (req.query.q || '').trim();
  const offset = (page - 1) * pageSize;
  const status = normalizeStatus(req.query.status);

  const params = [req.companyId];
  let where = 'WHERE company_id=$1';
  if (status === 'inactive') {
    params.push(false);
    where += ` AND active=$${params.length}`;
  } else if (status === 'active') {
    params.push(true);
    where += ` AND active=$${params.length}`;
  }
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length} OR responsavel ILIKE $${params.length})`;
  }

  try {
    const count = await query(`SELECT COUNT(*)::int AS total FROM clients ${where}`, params);
    params.push(pageSize, offset);
    const rows = await query(
      `SELECT * FROM clients ${where} ORDER BY name LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const data = rows.rows.map(attachDocument);
    res.json({ page, pageSize, total: count.rows[0].total, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', requireAuth, companyScope(true), async (req, res) => {
  try {
    const r = await query(`SELECT * FROM clients WHERE id=$1 AND company_id=$2`, [req.params.id, req.companyId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Cliente nao encontrado' });
    res.json(attachDocument(r.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireAuth, companyScope(true), async (req, res) => {
  const parse = clientSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { name, email, phone, responsavel, document } = parse.data;
  const cleanName = name.trim();
  const cleanEmail = email ? email.trim() : null;
  const cleanPhone = phone ? phone.trim() : null;
  const cleanResponsavel = responsavel ? responsavel.trim() : null;
  let docFields;
  try {
    docFields = splitDocument(document);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  try {
    await ensureUniqueClientIdentifiers(req.companyId, { email: cleanEmail, phone: cleanPhone });
    await assertClientLimit(req.companyId);
    const r = await query(
      `
      INSERT INTO clients (company_id, name, email, phone, responsavel, document_cpf, document_cnpj)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `,
      [
        req.companyId,
        cleanName,
        cleanEmail || null,
        cleanPhone || null,
        cleanResponsavel || null,
        docFields.cpf,
        docFields.cnpj,
      ]
    );
    res.status(201).json(attachDocument(r.rows[0]));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put('/:id', requireAuth, companyScope(true), async (req, res) => {
  const parse = clientSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { name, email, phone, responsavel, document } = parse.data;
  const cleanName = name.trim();
  const cleanEmail = email ? email.trim() : null;
  const cleanPhone = phone ? phone.trim() : null;
  const cleanResponsavel = responsavel ? responsavel.trim() : null;
  let docFields;
  try {
    docFields = splitDocument(document);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  try {
    await ensureUniqueClientIdentifiers(
      req.companyId,
      { email: cleanEmail, phone: cleanPhone },
      req.params.id
    );
    const r = await query(
      `
      UPDATE clients SET name=$1, email=$2, phone=$3, responsavel=$4, document_cpf=$5, document_cnpj=$6
      WHERE id=$7 AND company_id=$8 RETURNING *
    `,
      [
        cleanName,
        cleanEmail || null,
        cleanPhone || null,
        cleanResponsavel || null,
        docFields.cpf,
        docFields.cnpj,
        req.params.id,
        req.companyId,
      ]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Cliente nao encontrado' });
    res.json(attachDocument(r.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/status', requireAuth, companyScope(true), async (req, res) => {
  const { active } = req.body || {};
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'Campo active obrigatorio' });
  try {
    if (active) await assertClientLimit(req.companyId);
    const r = await query('UPDATE clients SET active=$1 WHERE id=$2 AND company_id=$3 RETURNING *', [
      active,
      req.params.id,
      req.companyId,
    ]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Cliente nao encontrado' });
    res.json(attachDocument(r.rows[0]));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, companyScope(true), async (req, res) => {
  try {
    const r = await query('UPDATE clients SET active=false WHERE id=$1 AND company_id=$2 RETURNING *', [
      req.params.id,
      req.companyId,
    ]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Cliente nao encontrado' });
    res.json({ ok: true, active: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
