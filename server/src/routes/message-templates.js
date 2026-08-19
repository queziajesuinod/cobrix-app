const express = require('express');
const { requireAuth, companyScope } = require('./auth');
const { requirePermission } = require('../services/permissions');
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
    // pixReady = a empresa consegue gerar um Pix copia e cola (Efí OU chave Pix
    // estática). É o que decide se as cobranças saem com o Pix em balão separado
    // ({{quebra}}), então é o flag que a tela usa para mostrar esses modelos.
    let hasPixKey = false;
    if (companyId) {
      const p = await query(`SELECT pix_key FROM ${SCHEMA}.companies WHERE id=$1`, [companyId]);
      hasPixKey = Boolean(p.rows[0]?.pix_key);
    }
    const pixReady = gatewayReady || hasPixKey;
    let audit = null;
    if (companyId) {
      const a = await query(
        `SELECT mt.updated_at, COALESCE(NULLIF(u.name,''), u.email) AS updated_by_name
           FROM ${SCHEMA}.message_templates mt
           LEFT JOIN ${SCHEMA}.users u ON u.id = mt.updated_by
          WHERE mt.company_id = $1 AND mt.updated_at IS NOT NULL
          ORDER BY mt.updated_at DESC LIMIT 1`,
        [companyId]
      );
      audit = a.rows[0] || null;
    }
    res.json({
      templates,
      defaults: DEFAULT_TEMPLATES,
      customTypes,
      gatewayReady,
      pixReady,
      audit,
      placeholders: PLACEHOLDERS.map(p => ({
        ...p,
        token: `{{${p.key}}}`,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/', requireAuth, companyScope(true), requirePermission('templates.edit'), async (req, res) => {
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
    await upsertTemplate(companyId, type, text, req.user.id);
    updated.push(type);
  }

  res.json({ ok: true, updated });
});

module.exports = router;
