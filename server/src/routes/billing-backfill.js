// server/src/routes/billing-backfill.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const { runBillingBackfill } = require('../jobs/billing-backfill');

/**
 * POST /api/billing-backfill
 *
 * Header obrigatório: X-Company-Id (validado pelo requireAuth)
 *
 * Body (todos opcionais):
 *   dryRun          boolean - true = apenas simula, não cria (padrão: true)
 *   contractId      number  - filtrar por contrato específico
 *   includeInactive boolean - incluir contratos inativos (padrão: false)
 *   until           string  - data limite YYYY-MM-DD (padrão: hoje)
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      dryRun = true,
      contractId = null,
      includeInactive = false,
      until = null,
    } = req.body || {};

    // companyId sempre vem do token/header validado pelo requireAuth
    const companyId = req.companyId;

    const untilDate = until ? new Date(until) : new Date();
    if (until && isNaN(untilDate.getTime())) {
      return res.status(400).json({ error: 'Parâmetro "until" inválido. Use formato YYYY-MM-DD.' });
    }

    const report = await runBillingBackfill({
      dryRun: Boolean(dryRun),
      companyId,
      contractId: contractId ? Number(contractId) : null,
      includeInactive: Boolean(includeInactive),
      until: untilDate,
    });

    return res.json(report);
  } catch (err) {
    console.error('[BACKFILL] Erro na rota:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/billing-backfill/preview
 *
 * Header obrigatório: X-Company-Id (validado pelo requireAuth)
 *
 * Query params (opcionais):
 *   contractId, includeInactive, until
 */
router.get('/preview', requireAuth, async (req, res) => {
  try {
    const { contractId, includeInactive, until } = req.query;

    // companyId sempre vem do token/header validado pelo requireAuth
    const companyId = req.companyId;

    const untilDate = until ? new Date(until) : new Date();
    if (until && isNaN(untilDate.getTime())) {
      return res.status(400).json({ error: 'Parâmetro "until" inválido. Use formato YYYY-MM-DD.' });
    }

    const report = await runBillingBackfill({
      dryRun: true,
      companyId,
      contractId: contractId ? Number(contractId) : null,
      includeInactive: includeInactive === 'true',
      until: untilDate,
    });

    return res.json(report);
  } catch (err) {
    console.error('[BACKFILL] Erro no preview:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
