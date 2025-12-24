const express = require('express');
const { requireAuth, companyScope } = require('./auth');
const { query } = require('../db');
const {
  DEFAULT_TEMPLATES,
  PLACEHOLDERS,
  getTemplatesForCompany,
  upsertTemplate,
} = require('../services/message-templates');
const { isGatewayConfigured } = require('../services/company-gateway');

const router = express.Router();
const SCHEMA = process.env.DB_SCHEMA || 'public';

const ALLOWED_TYPES = Object.keys(DEFAULT_TEMPLATES);

router.get('/', requireAuth, companyScope(true), async (req, res) => {
  try {
    const companyId = req.companyId;
    const templates = await getTemplatesForCompany(companyId);
    let customTypes = [];
    if (companyId) {
      const rows = await query(`
        SELECT type FROM ${SCHEMA}.message_templates
        WHERE company_id = $1
      `, [companyId]);
      customTypes = rows.rows.map(r => r.type);
    }
    const gatewayReady = await isGatewayConfigured(companyId);
    res.json({
      templates,
      defaults: DEFAULT_TEMPLATES,
      customTypes,
      gatewayReady,
      placeholders: PLACEHOLDERS.map(p => ({
        ...p,
        token: `{{${p.key}}}`,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/', requireAuth, companyScope(true), async (req, res) => {
  const { templates } = req.body || {};
  if (!templates || typeof templates !== 'object') {
    return res.status(400).json({ error: 'Campo templates obrigatório' });
  }

  const companyId = req.companyId;
  if (!companyId) return res.status(400).json({ error: 'companyId obrigatório' });

  const updated = [];
  for (const [type, content] of Object.entries(templates)) {
    if (!ALLOWED_TYPES.includes(type)) continue;
    const text = String(content ?? '').trim();
    if (!text) {
      return res.status(400).json({ error: `Template ${type} não pode ser vazio` });
    }
    await upsertTemplate(companyId, type, text);
    updated.push(type);
  }

  res.json({ ok: true, updated });
});

module.exports = router;
