const { query } = require('../db');
const { getConnectionState, resolveBase } = require('./evo-api');
const logger = require('../utils/logger');

const SCHEMA = process.env.DB_SCHEMA || 'public';
const MAX_RETRIES = Number(process.env.NOTIFICATION_MAX_RETRIES || 3);
const RETRY_WINDOW_HOURS = Number(process.env.NOTIFICATION_RETRY_WINDOW_HOURS || 48);

const KNOWN_CRON_JOBS = [
  { jobName: 'DUE', label: 'Cobrança D0', scheduleExpression: process.env.CRON_DUE || null },
  { jobName: 'PRE', label: 'Cobrança D-4', scheduleExpression: process.env.CRON_PRE || null },
  { jobName: 'LATE', label: 'Cobrança D+3', scheduleExpression: process.env.CRON_LATE || null },
  { jobName: 'RENEW', label: 'Renovação recorrente', scheduleExpression: process.env.CRON_RENEW || null },
  { jobName: 'RETRY', label: 'Retry de notificações', scheduleExpression: process.env.CRON_RETRY || '*/30 * * * *' },
];

function normalizeCronStatus(status) {
  const value = String(status || '').toLowerCase();
  if (['ok', 'error', 'running', 'skipped', 'never'].includes(value)) return value;
  return 'never';
}

function truncateText(value, max = 160) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function parseDate(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function inferCronResolutionHint(jobName, status, errorText) {
  if (status !== 'error') return null;
  const msg = String(errorText || '').toLowerCase();

  if (/evo_api|apikey|unauthorized|401|403/.test(msg)) {
    return 'Verifique as credenciais EVO (URL/API key) da empresa e permissão da instância.';
  }
  if (/timeout|etimedout|socket hang up/.test(msg)) {
    return 'Falha de timeout. Verifique latencia de rede e disponibilidade do provedor externo.';
  }
  if (/enotfound|econnrefused|network|dns|connect/.test(msg)) {
    return 'Erro de conectividade. Validar DNS/firewall e conectividade com banco, gateway e EVO.';
  }
  if (/duplicate key|unique constraint/.test(msg)) {
    return 'Conflito de dados. Revisar idempotencia e registros duplicados relacionados ao job.';
  }
  if (jobName === 'RETRY') {
    return 'Revise os erros de envio na fila de retry (telefone, instância EVO, bloqueio do provedor).';
  }
  if (jobName === 'GATEWAY_RECONCILE') {
    return 'Verifique configuração do gateway e webhook PIX. Reconcile falhando pode atrasar baixas de pagamento.';
  }

  return 'Consulte o erro completo nos logs da aplicação para identificar a causa raiz e ajustar configurações.';
}

function inferRetryAction({ reason, retryCount, canRetry, exhausted, maxRetries }) {
  const normalizedReason = String(reason || '').toLowerCase();

  if (/no-phone|telefone|phone|number/.test(normalizedReason)) {
    return 'Atualizar telefone do cliente e validar formato antes do próximo envio.';
  }
  if (/unauthorized|apikey|token|401|403/.test(normalizedReason)) {
    return 'Credencial inválida. Revisar API key e permissões da instância EVO.';
  }
  if (/timeout|network|connect|enotfound|econnrefused/.test(normalizedReason)) {
    return 'Falha de conectividade. Validar disponibilidade de rede e provedor antes de reenviar.';
  }
  if (exhausted || retryCount >= maxRetries) {
    return 'Tentativas esgotadas. Ajuste limite de retries ou execute reenvio manual após corrigir causa.';
  }
  if (!canRetry) {
    return 'Registro fora da janela automatica de retry. Considere reenvio manual.';
  }
  return 'Pode ser reenviado automaticamente após o próximo agendamento de retry.';
}

function inferEvoResolutionHint({ connectionStatus, error, instance }) {
  const status = String(connectionStatus || '').toLowerCase();
  const err = String(error || '').toLowerCase();

  if (status === 'missing') {
    return 'Empresa sem instância EVO configurada. Crie/conecte a instância em Integração.';
  }
  if (status === 'missing-company') {
    return 'Empresa não encontrada no contexto selecionado.';
  }
  if (status === 'open' || status === 'connected' || status === 'online') {
    return 'Instância conectada e pronta para envio.';
  }
  if (/unauthorized|apikey|401|403/.test(err)) {
    return 'Falha de autenticação no EVO. Revisar URL/API key e permissões da instância.';
  }
  if (/timeout|network|connect|enotfound|econnrefused/.test(err)) {
    return 'Falha de rede com EVO. Validar endpoint, DNS e firewall.';
  }
  if (instance) {
    return 'Instância offline. Refaça conexão via QR code em Integração > WhatsApp.';
  }
  return 'Verifique configuração da integração EVO.';
}

async function registerCronJob(jobName, scheduleExpression = null) {
  if (!jobName) return;
  await query(
    `INSERT INTO ${SCHEMA}.system_cron_runs (job_name, schedule_expression, last_status, updated_at)
     VALUES ($1, $2, 'never', NOW())
     ON CONFLICT (job_name)
     DO UPDATE SET
       schedule_expression = COALESCE(EXCLUDED.schedule_expression, ${SCHEMA}.system_cron_runs.schedule_expression),
       updated_at = NOW()`,
    [String(jobName), scheduleExpression || null]
  );
}

async function markCronJobStarted(jobName, scheduleExpression = null) {
  if (!jobName) return;
  await query(
    `INSERT INTO ${SCHEMA}.system_cron_runs
      (job_name, schedule_expression, last_started_at, last_status, last_error, updated_at)
     VALUES
      ($1, $2, NOW(), 'running', NULL, NOW())
     ON CONFLICT (job_name)
     DO UPDATE SET
       schedule_expression = COALESCE(EXCLUDED.schedule_expression, ${SCHEMA}.system_cron_runs.schedule_expression),
       last_started_at = NOW(),
       last_status = 'running',
       last_error = NULL,
       updated_at = NOW()`,
    [String(jobName), scheduleExpression || null]
  );
}

async function markCronJobFinished(jobName, { status = 'ok', error = null } = {}) {
  if (!jobName) return;
  const finalStatus = normalizeCronStatus(status);
  const errorText = error ? String(error).slice(0, 2000) : null;
  await query(
    `INSERT INTO ${SCHEMA}.system_cron_runs
      (job_name, last_finished_at, last_status, last_error, updated_at)
     VALUES
      ($1, NOW(), $2, $3, NOW())
     ON CONFLICT (job_name)
     DO UPDATE SET
       last_finished_at = NOW(),
       last_status = EXCLUDED.last_status,
       last_error = EXCLUDED.last_error,
       updated_at = NOW()`,
    [String(jobName), finalStatus, errorText]
  );
}

async function getCronJobsHealth(extraJobs = []) {
  const rows = await query(
    `SELECT job_name, schedule_expression, last_started_at, last_finished_at, last_status, last_error
       FROM ${SCHEMA}.system_cron_runs
      ORDER BY job_name ASC`
  );

  const known = [...KNOWN_CRON_JOBS, ...extraJobs].reduce((acc, item) => {
    if (!item?.jobName) return acc;
    acc.set(item.jobName, item);
    return acc;
  }, new Map());

  const dbByJob = new Map(rows.rows.map((row) => [row.job_name, row]));

  for (const [jobName, item] of known.entries()) {
    if (!dbByJob.has(jobName)) {
      dbByJob.set(jobName, {
        job_name: jobName,
        schedule_expression: item.scheduleExpression || null,
        last_started_at: null,
        last_finished_at: null,
        last_status: 'never',
        last_error: null,
      });
    }
  }

  return Array.from(dbByJob.values())
    .map((row) => {
      const def = known.get(row.job_name);
      const status = normalizeCronStatus(row.last_status);
      const startedAt = parseDate(row.last_started_at);
      const finishedAt = parseDate(row.last_finished_at);
      const durationMs = startedAt && finishedAt ? finishedAt.getTime() - startedAt.getTime() : null;
      const runningForMs = status === 'running' && startedAt ? Date.now() - startedAt.getTime() : null;

      return {
        jobName: row.job_name,
        label: def?.label || row.job_name,
        scheduleExpression: row.schedule_expression || def?.scheduleExpression || null,
        lastStartedAt: row.last_started_at || null,
        lastFinishedAt: row.last_finished_at || null,
        durationSeconds: durationMs != null && durationMs >= 0 ? Math.round(durationMs / 1000) : null,
        runningForSeconds: runningForMs != null && runningForMs >= 0 ? Math.round(runningForMs / 1000) : null,
        status,
        error: row.last_error || null,
        resolutionHint: inferCronResolutionHint(row.job_name, status, row.last_error),
      };
    })
    .sort((a, b) => a.jobName.localeCompare(b.jobName));
}

async function getRetryQueueHealth(companyId) {
  const [summaryResult, reasonsResult, recentResult] = await Promise.all([
    query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_total,
         COUNT(*) FILTER (
           WHERE status = 'failed'
             AND retry_count < $2
             AND created_at > NOW() - ($3 * INTERVAL '1 hour')
         )::int AS retryable_total,
         COUNT(*) FILTER (
           WHERE status = 'failed'
             AND retry_count < $2
             AND created_at > NOW() - ($3 * INTERVAL '1 hour')
             AND (next_retry_at IS NULL OR next_retry_at <= NOW())
         )::int AS retry_due_now,
         COUNT(*) FILTER (
           WHERE status = 'failed'
             AND retry_count >= $2
         )::int AS exhausted_total
       FROM ${SCHEMA}.billing_notifications
       WHERE company_id = $1`,
      [companyId, MAX_RETRIES, RETRY_WINDOW_HOURS]
    ),
    query(
      `SELECT
         COALESCE(NULLIF(TRIM(error), ''), 'Sem detalhe de erro') AS reason,
         COUNT(*)::int AS total
       FROM ${SCHEMA}.billing_notifications
       WHERE company_id = $1
         AND status = 'failed'
       GROUP BY COALESCE(NULLIF(TRIM(error), ''), 'Sem detalhe de erro')
       ORDER BY COUNT(*) DESC
       LIMIT 7`,
      [companyId]
    ),
    query(
      `SELECT
         id,
         contract_id,
         to_number,
         type,
         kind,
         due_date,
         retry_count,
         next_retry_at,
         created_at,
         error
       FROM ${SCHEMA}.billing_notifications
       WHERE company_id = $1
         AND status = 'failed'
       ORDER BY created_at DESC
       LIMIT 20`,
      [companyId]
    ),
  ]);

  const summary = summaryResult.rows[0] || {};
  const nowMs = Date.now();
  const cutoffMs = nowMs - (RETRY_WINDOW_HOURS * 60 * 60 * 1000);

  const topReasons = reasonsResult.rows.map((row) => ({
    reason: truncateText(row.reason, 180),
    total: Number(row.total || 0),
  }));

  const recentFailures = recentResult.rows.map((row) => {
    const createdAt = parseDate(row.created_at);
    const nextRetryAt = parseDate(row.next_retry_at);
    const retryCount = Number(row.retry_count || 0);
    const exhausted = retryCount >= MAX_RETRIES;
    const withinWindow = createdAt ? createdAt.getTime() >= cutoffMs : false;
    const canRetry = !exhausted && withinWindow;
    const dueNow = canRetry && (!nextRetryAt || nextRetryAt.getTime() <= nowMs);
    const reason = row.error || 'Sem detalhe de erro';

    return {
      id: Number(row.id),
      contractId: row.contract_id != null ? Number(row.contract_id) : null,
      toNumber: row.to_number || null,
      kind: row.kind || null,
      type: row.type || null,
      dueDate: row.due_date || null,
      createdAt: row.created_at || null,
      retryCount,
      nextRetryAt: row.next_retry_at || null,
      exhausted,
      canRetry,
      dueNow,
      reason,
      suggestedAction: inferRetryAction({
        reason,
        retryCount,
        canRetry,
        exhausted,
        maxRetries: MAX_RETRIES,
      }),
    };
  });

  return {
    failedTotal: Number(summary.failed_total || 0),
    retryableTotal: Number(summary.retryable_total || 0),
    retryDueNow: Number(summary.retry_due_now || 0),
    exhaustedTotal: Number(summary.exhausted_total || 0),
    maxRetries: MAX_RETRIES,
    retryWindowHours: RETRY_WINDOW_HOURS,
    topReasons,
    recentFailures,
  };
}

function normalizeConnectionStatus(raw) {
  return String(raw || 'unknown').trim().toLowerCase();
}

function isOnlineStatus(status) {
  return status === 'open' || status === 'connected' || status === 'online';
}

async function getEvoHealth(companyId) {
  const company = await query(
    `SELECT id, evo_instance, evo_api_url, evo_api_key
       FROM ${SCHEMA}.companies
      WHERE id = $1`,
    [companyId]
  );
  const row = company.rows[0];
  if (!row) {
    const evoMissingCompany = {
      instance: null,
      connectionStatus: 'missing-company',
      online: false,
      checkedAt: new Date().toISOString(),
      error: 'Empresa não encontrada',
    };
    return {
      ...evoMissingCompany,
      resolutionHint: inferEvoResolutionHint(evoMissingCompany),
    };
  }
  if (!row.evo_instance) {
    const evoMissing = {
      instance: null,
      connectionStatus: 'missing',
      online: false,
      checkedAt: new Date().toISOString(),
      error: null,
    };
    return {
      ...evoMissing,
      resolutionHint: inferEvoResolutionHint(evoMissing),
    };
  }

  const evoOptions = {
    baseOverride: resolveBase(row.evo_api_url) || null,
    apiKeyOverride: row.evo_api_key || null,
  };
  try {
    const state = await getConnectionState(row.evo_instance, evoOptions);
    const connectionStatus = normalizeConnectionStatus(
      state?.connectionStatus || state?.instance?.state || 'unknown'
    );
    const evoOk = {
      instance: state?.instance?.instanceName || row.evo_instance,
      connectionStatus,
      online: isOnlineStatus(connectionStatus),
      checkedAt: new Date().toISOString(),
      error: null,
    };
    return {
      ...evoOk,
      resolutionHint: inferEvoResolutionHint(evoOk),
    };
  } catch (err) {
    logger.warn(
      {
        companyId,
        instance: row.evo_instance,
        status: err?.status,
        message: err?.message,
      },
      '[system-health] failed to check EVO state'
    );
    const evoOffline = {
      instance: row.evo_instance,
      connectionStatus: 'offline',
      online: false,
      checkedAt: new Date().toISOString(),
      error: err?.message || 'Falha ao consultar EVO',
    };
    return {
      ...evoOffline,
      resolutionHint: inferEvoResolutionHint(evoOffline),
    };
  }
}

function gatewayScheduleExpression() {
  const ms = Number(process.env.GATEWAY_POLL_MS || 300000);
  if (Number.isFinite(ms) && ms > 0) return `interval:${ms}ms`;
  return null;
}

function buildRecommendations({ cronJobs, retryQueue, evo }) {
  const items = [];
  const failedCrons = cronJobs.filter((job) => job.status === 'error');

  if (failedCrons.length > 0) {
    items.push({
      severity: 'error',
      title: `Existem ${failedCrons.length} cron(s) com falha`,
      details: failedCrons.map((job) => `${job.jobName}: ${truncateText(job.error || 'erro sem detalhe', 120)}`).join(' | '),
      action: 'Revise o motivo no quadro de cron e ajuste configuração/infra antes da próxima execução.',
    });
  }

  if (Number(retryQueue.retryDueNow || 0) > 0) {
    items.push({
      severity: 'warning',
      title: `${retryQueue.retryDueNow} notificação(ões) falhas prontas para retry`,
      details: 'Esses registros devem ser processados no próximo ciclo do job RETRY.',
      action: 'Se o numero crescer, valide conectividade EVO e dados de contato dos clientes.',
    });
  }

  if (Number(retryQueue.exhaustedTotal || 0) > 0) {
    items.push({
      severity: 'warning',
      title: `${retryQueue.exhaustedTotal} notificação(ões) com tentativas esgotadas`,
      details: `Limite atual: ${retryQueue.maxRetries} tentativas em janela de ${retryQueue.retryWindowHours}h.`,
      action: 'Considere ajustar variáveis NOTIFICATION_MAX_RETRIES/NOTIFICATION_RETRY_WINDOW_HOURS ou reenviar manualmente.',
    });
  }

  if (!evo.online) {
    items.push({
      severity: 'error',
      title: 'EVO WhatsApp offline ou indisponível',
      details: truncateText(evo.error || `Status: ${evo.connectionStatus || 'unknown'}`, 160),
      action: evo.resolutionHint || 'Reconectar instância EVO na tela de Integração.',
    });
  }

  if (items.length === 0) {
    items.push({
      severity: 'success',
      title: 'Sem incidentes críticos no momento',
      details: 'Cron, retries e EVO estão em estado saudável.',
      action: 'Mantenha monitoramento periódico e alertas ativos.',
    });
  }

  return items;
}

async function getSystemHealth(companyId) {
  const extraJobs = [
    {
      jobName: 'GATEWAY_RECONCILE',
      label: 'Reconciliação do gateway',
      scheduleExpression: gatewayScheduleExpression(),
    },
  ];

  const [cronJobs, retryQueue, evo] = await Promise.all([
    getCronJobsHealth(extraJobs),
    getRetryQueueHealth(companyId),
    getEvoHealth(companyId),
  ]);

  const recommendations = buildRecommendations({ cronJobs, retryQueue, evo });

  return {
    generatedAt: new Date().toISOString(),
    meta: {
      timezone: process.env.CRON_TZ || process.env.TZ || 'server-local',
    },
    summary: {
      cronWithError: cronJobs.filter((job) => job.status === 'error').length,
      cronRunning: cronJobs.filter((job) => job.status === 'running').length,
      retryDueNow: Number(retryQueue.retryDueNow || 0),
      retryExhausted: Number(retryQueue.exhaustedTotal || 0),
      evoOnline: Boolean(evo.online),
    },
    cronJobs,
    retryQueue,
    evo,
    recommendations,
  };
}

module.exports = {
  KNOWN_CRON_JOBS,
  registerCronJob,
  markCronJobStarted,
  markCronJobFinished,
  getSystemHealth,
  gatewayScheduleExpression,
};

