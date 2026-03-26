const express = require('express');
const { requireAuth, companyScope } = require('./auth');
const { getSystemHealth } = require('../services/system-health');

const router = express.Router();

function canReadSystemHealth(user) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'master';
}

router.get('/health', requireAuth, companyScope(true), async (req, res) => {
  if (!canReadSystemHealth(req.user)) {
    return res.status(403).json({ error: 'Sem permissão para visualizar saúde do sistema' });
  }
  try {
    const snapshot = await getSystemHealth(req.companyId);
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
