const express = require('express');
const { query } = require('../db');
const { requireAuth, companyScope } = require('./auth');
const { syncSystemNotifications } = require('../services/notifications');
const { respondError } = require('../utils/http-error');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const router = express.Router();

// GET /notifications — lista as não lidas do usuário logado (na empresa atual)
// e o total de não lidas. Recalcula os alertas de sistema antes de responder.
router.get('/', requireAuth, companyScope(true), async (req, res) => {
  try {
    try { await syncSystemNotifications(req.companyId, new Date()); }
    catch (e) { console.error('[notifications] sync falhou:', e.message); }

    const r = await query(
      `SELECT n.id, n.type, n.title, n.body, n.ref_type, n.ref_id, n.link, n.created_at
         FROM ${SCHEMA}.notifications n
         LEFT JOIN ${SCHEMA}.notification_reads nr
           ON nr.notification_id = n.id AND nr.user_id = $2
        WHERE n.company_id = $1
          AND (n.user_id IS NULL OR n.user_id = $2)
          AND nr.notification_id IS NULL
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT 50`,
      [req.companyId, req.user.id]
    );
    res.json({ items: r.rows, unreadCount: r.rowCount });
  } catch (e) {
    respondError(res, e);
  }
});

// POST /notifications/read-all — marca todas as não lidas como lidas
router.post('/read-all', requireAuth, companyScope(true), async (req, res) => {
  try {
    await query(
      `INSERT INTO ${SCHEMA}.notification_reads (notification_id, user_id)
       SELECT n.id, $2 FROM ${SCHEMA}.notifications n
        WHERE n.company_id = $1 AND (n.user_id IS NULL OR n.user_id = $2)
       ON CONFLICT (notification_id, user_id) DO NOTHING`,
      [req.companyId, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) {
    respondError(res, e);
  }
});

// POST /notifications/:id/read — marca uma notificação como lida
router.post('/:id/read', requireAuth, companyScope(true), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const owns = await query(
      `SELECT 1 FROM ${SCHEMA}.notifications WHERE id = $1 AND company_id = $2`,
      [id, req.companyId]
    );
    if (!owns.rowCount) return res.status(404).json({ error: 'Notificação não encontrada' });
    await query(
      `INSERT INTO ${SCHEMA}.notification_reads (notification_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (notification_id, user_id) DO NOTHING`,
      [id, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) {
    respondError(res, e);
  }
});

module.exports = router;
