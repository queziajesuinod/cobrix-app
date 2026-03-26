// =========================
// server.js
// =========================

// 1) Environment variables
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const ENV_CANDIDATES = [
  '/app/server/.env',
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
];

for (const candidate of ENV_CANDIDATES) {
  try {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      break;
    }
  } catch (err) {
    console.warn('[env] Failed to load', candidate, err.message);
  }
}

const express = require('express');
const cron = require('node-cron');

// 2) Base app
const app = require('./app');

// 3) Cron jobs
const { runDueOnly, runPreOnly, runLateOnly, runRenewOnly } = require('./jobs/billing-cron');
const { runGatewayReconcile } = require('./jobs/gateway-reconcile');
const { runNotificationRetry } = require('./jobs/notification-retry');
const { withCronLock } = require('./utils/cron-lock');
const logger = require('./utils/logger');
const {
  registerCronJob,
  markCronJobStarted,
  markCronJobFinished,
  gatewayScheduleExpression,
} = require('./services/system-health');

function trackCron(jobName, fn) {
  return fn().catch((err) => {
    logger.warn({ err, job: jobName }, '[cron-health] failed to persist cron state');
  });
}

function scheduleCronJob(label, expression, job) {
  trackCron(label, () => registerCronJob(label, expression || null));
  if (!expression) return;

  const options = process.env.CRON_TZ ? { timezone: process.env.CRON_TZ } : undefined;
  const tzLabel = options?.timezone ? ` tz=${options.timezone}` : '';
  logger.info({ job: label, expression, tz: options?.timezone }, `[CRON] scheduling ${label} (${expression}${tzLabel})`);

  cron.schedule(expression, async () => {
    const start = Date.now();
    await trackCron(label, () => markCronJobStarted(label, expression));

    logger.info({ job: label }, `[CRON] starting ${label}`);
    let finalStatus = 'ok';
    let errorMessage = null;

    try {
      const executed = await withCronLock(label, job);
      if (!executed) finalStatus = 'skipped';
      logger.info({ job: label, ms: Date.now() - start, status: finalStatus }, `[CRON] completed ${label}`);
    } catch (err) {
      finalStatus = 'error';
      errorMessage = err?.message || String(err);
      logger.error({ err, job: label, ms: Date.now() - start }, `[CRON] failed ${label}`);
    } finally {
      await trackCron(label, () => markCronJobFinished(label, { status: finalStatus, error: errorMessage }));
    }
  }, options);
}

// D0 - Due
scheduleCronJob('DUE', process.env.CRON_DUE, runDueOnly);
// D-4 - Pre
scheduleCronJob('PRE', process.env.CRON_PRE, runPreOnly);
// D+3 - Late
scheduleCronJob('LATE', process.env.CRON_LATE, runLateOnly);
// Contract recurring renewal
scheduleCronJob('RENEW', process.env.CRON_RENEW, runRenewOnly);
// Notification retry (default: every 30 min)
scheduleCronJob('RETRY', process.env.CRON_RETRY || '*/30 * * * *', runNotificationRetry);

// Gateway fallback polling
const gatewayPollMs = Number(process.env.GATEWAY_POLL_MS || 300000);
const gatewayJobName = 'GATEWAY_RECONCILE';
const gatewayExpression = gatewayScheduleExpression();
trackCron(gatewayJobName, () => registerCronJob(gatewayJobName, gatewayExpression));

if (!Number.isNaN(gatewayPollMs) && gatewayPollMs > 0) {
  logger.info({ intervalMs: gatewayPollMs }, '[gateway-reconcile] fallback polling enabled');

  setInterval(async () => {
    const start = Date.now();
    await trackCron(gatewayJobName, () => markCronJobStarted(gatewayJobName, gatewayExpression));

    let finalStatus = 'ok';
    let errorMessage = null;

    try {
      const executed = await withCronLock(gatewayJobName, () => runGatewayReconcile());
      if (!executed) finalStatus = 'skipped';
      logger.info({ ms: Date.now() - start, status: finalStatus }, '[gateway-reconcile] polling cycle finished');
    } catch (err) {
      finalStatus = 'error';
      errorMessage = err?.message || String(err);
      logger.error({ err }, '[gateway-reconcile] polling cycle failed');
    } finally {
      await trackCron(gatewayJobName, () => markCronJobFinished(gatewayJobName, { status: finalStatus, error: errorMessage }));
    }
  }, gatewayPollMs);
}

// 4) Serve frontend build (dist/public)
const candidateDirs = [
  path.resolve(__dirname, '../../client/dist'),
  path.resolve(__dirname, '../public'),
];

const staticDir = candidateDirs.find((dir) => {
  try {
    return fs.existsSync(path.join(dir, 'index.html'));
  } catch {
    return false;
  }
});

if (staticDir) {
  console.log('[static] Serving frontend from', staticDir);
  app.use(express.static(staticDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(staticDir, 'index.html'));
  });
} else {
  console.warn('[static] Frontend build not found. SPA refresh routes may fail.');
}

// 5) Server start
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  logger.info(
    {
      port: PORT,
      schema: process.env.DB_SCHEMA || 'public',
      env: process.env.NODE_ENV || 'production',
      tz: process.env.TZ,
      webhook: process.env.EFI_WEBHOOK_SECRET ? 'configured' : 'missing secret (insecure)',
    },
    `Server listening on port ${PORT}`
  );
});
