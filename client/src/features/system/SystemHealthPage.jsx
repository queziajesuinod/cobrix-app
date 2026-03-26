import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import WifiTetheringIcon from '@mui/icons-material/WifiTethering';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import PageHeader from '@/components/PageHeader';
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert';
import { useAuth } from '@/features/auth/AuthContext';
import { systemHealthService } from '@/features/system/systemHealth.service';

const STATUS_META = {
  ok: { label: 'OK', color: 'success' },
  error: { label: 'Erro', color: 'error' },
  running: { label: 'Executando', color: 'info' },
  skipped: { label: 'Pulado', color: 'default' },
  never: { label: 'Nunca executado', color: 'default' },
};
const WEEKDAY_LABELS = {
  0: 'Dom',
  1: 'Seg',
  2: 'Ter',
  3: 'Qua',
  4: 'Qui',
  5: 'Sex',
  6: 'Sáb',
};

function formatDateTime(value) {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '-';
  return dt.toLocaleString('pt-BR');
}

function isIntegerString(value) {
  return /^-?\d+$/.test(String(value || '').trim());
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatWeekdays(value) {
  const tokens = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!tokens.length) return value;

  const labels = tokens.map((token) => {
    if (!isIntegerString(token)) return token;
    const num = Number(token);
    return WEEKDAY_LABELS[num] || token;
  });
  return labels.join(', ');
}

function describeSchedule(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return {
      primary: 'Não configurado',
      secondary: 'Job desativado (sem expressão de agenda)',
      raw: '-',
    };
  }

  if (raw.startsWith('interval:')) {
    const ms = Number(raw.replace('interval:', '').replace('ms', ''));
    if (!Number.isFinite(ms) || ms <= 0) {
      return {
        primary: 'Intervalo customizado',
        secondary: 'Não foi possível interpretar o intervalo',
        raw,
      };
    }

    const seconds = Math.round(ms / 1000);
    if (seconds < 60) {
      return {
        primary: `A cada ${seconds}s`,
        secondary: 'Execução por timer interno (polling)',
        raw,
      };
    }

    const minutes = Math.round(ms / 60000);
    if (minutes < 60) {
      return {
        primary: `A cada ${minutes} min`,
        secondary: 'Execução por timer interno (polling)',
        raw,
      };
    }

    const hours = (minutes / 60).toFixed(1).replace('.', ',');
    return {
      primary: `A cada ${hours} h`,
      secondary: 'Execução por timer interno (polling)',
      raw,
    };
  }

  const parts = raw.split(/\s+/);
  if (parts.length !== 5) {
    return {
      primary: 'Cron personalizado',
      secondary: 'Formato não reconhecido automaticamente',
      raw,
    };
  }

  const [min, hour, dayMonth, month, dayWeek] = parts;
  const hasFixedTime = isIntegerString(min) && isIntegerString(hour);
  const timeLabel = hasFixedTime ? `${pad2(hour)}:${pad2(min)}` : null;

  if (raw === '* * * * *') {
    return {
      primary: 'A cada minuto',
      secondary: 'Executa continuamente em todos os minutos',
      raw,
    };
  }

  if (/^\*\/\d+$/.test(min) && hour === '*' && dayMonth === '*' && month === '*' && dayWeek === '*') {
    const n = Number(min.replace('*/', ''));
    return {
      primary: `A cada ${n} min`,
      secondary: 'Executa em qualquer hora/dia',
      raw,
    };
  }

  if (min === '0' && hour === '*' && dayMonth === '*' && month === '*' && dayWeek === '*') {
    return {
      primary: 'A cada 1 hora',
      secondary: 'Executa no minuto zero de toda hora',
      raw,
    };
  }

  if (hasFixedTime && dayMonth === '*' && month === '*' && dayWeek === '*') {
    return {
      primary: `Diário às ${timeLabel}`,
      secondary: 'Executa todos os dias',
      raw,
    };
  }

  if (hasFixedTime && dayMonth === '*' && month === '*' && dayWeek !== '*') {
    return {
      primary: `Semanal as ${timeLabel}`,
      secondary: `Dias da semana: ${formatWeekdays(dayWeek)}`,
      raw,
    };
  }

  if (hasFixedTime && isIntegerString(dayMonth) && month === '*' && dayWeek === '*') {
    return {
      primary: `Mensal (dia ${dayMonth}) as ${timeLabel}`,
      secondary: 'Executa no mesmo dia todo mês',
      raw,
    };
  }

  if (hasFixedTime && isIntegerString(dayMonth) && isIntegerString(month) && dayWeek === '*') {
    return {
      primary: `Anual (${dayMonth}/${month}) as ${timeLabel}`,
      secondary: 'Executa uma vez por ano',
      raw,
    };
  }

  return {
    primary: 'Cron personalizado',
    secondary: `m=${min} h=${hour} dom=${dayMonth} mon=${month} dow=${dayWeek}`,
    raw,
  };
}

function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '-';
  const value = Number(seconds);
  if (value < 60) return `${value}s`;
  const min = Math.floor(value / 60);
  const sec = value % 60;
  return `${min}m ${sec}s`;
}

function CronStatusChip({ status }) {
  const meta = STATUS_META[String(status || '').toLowerCase()] || STATUS_META.never;
  return <Chip size="small" label={meta.label} color={meta.color} variant={meta.color === 'default' ? 'outlined' : 'filled'} />;
}

function EvoStatusChip({ online, connectionStatus }) {
  return (
    <Chip
      size="small"
      color={online ? 'success' : 'error'}
      label={online ? `ONLINE (${String(connectionStatus || '').toUpperCase()})` : `OFFLINE (${String(connectionStatus || 'unknown').toUpperCase()})`}
    />
  );
}

function RetryStateChip({ failure }) {
  if (failure?.exhausted) {
    return <Chip size="small" color="error" label="Esgotado" />;
  }
  if (failure?.dueNow) {
    return <Chip size="small" color="warning" label="Retry agora" />;
  }
  if (failure?.canRetry) {
    return <Chip size="small" color="info" label="Aguardando" />;
  }
  return <Chip size="small" variant="outlined" label="Fora da janela" />;
}

function RecommendationAlert({ item }) {
  const severity = ['error', 'warning', 'success', 'info'].includes(item?.severity) ? item.severity : 'info';
  return (
    <Alert severity={severity} icon={<ReportProblemIcon />}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{item?.title || 'Recomendação'}</Typography>
      <Typography variant="body2">{item?.details || '-'}</Typography>
      {item?.action ? <Typography variant="body2" sx={{ mt: 0.5 }}><strong>Ação:</strong> {item.action}</Typography> : null}
    </Alert>
  );
}

export default function SystemHealthPage() {
  const { selectedCompanyId, user } = useAuth();
  const enabled = Number.isInteger(selectedCompanyId);
  const canView = String(user?.role || '').toLowerCase() === 'master';

  const healthQuery = useQuery({
    queryKey: ['system-health', selectedCompanyId],
    queryFn: systemHealthService.getHealth,
    enabled: enabled && canView,
    refetchInterval: 30000,
    staleTime: 10000,
  });

  const data = healthQuery.data;
  const summary = data?.summary || {};
  const cronJobs = data?.cronJobs || [];
  const retryQueue = data?.retryQueue || {};
  const evo = data?.evo || {};
  const recommendations = data?.recommendations || [];
  const timezone = data?.meta?.timezone || 'server-local';

  return (
    <Stack spacing={2}>
      <CompanyRequiredAlert />

      {!canView && (
        <Alert severity="warning">Apenas perfil Master pode visualizar a saúde do sistema.</Alert>
      )}
      {!enabled && canView && (
        <Alert severity="info">Selecione uma empresa para carregar o dashboard interno de saúde.</Alert>
      )}

      <PageHeader
        title="Saúde do sistema"
        subtitle="Diagnóstico operacional de crons, fila de retries e integração EVO para acelerar resolução de falhas."
        actions={
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => healthQuery.refetch()}
            disabled={!enabled || !canView || healthQuery.isFetching}
          >
            Atualizar agora
          </Button>
        }
      />

      {healthQuery.isError && (
        <Alert severity="error">
          {healthQuery.error?.response?.data?.error || healthQuery.error?.message || 'Falha ao carregar dados de saúde.'}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
            <Chip icon={<MonitorHeartIcon />} label={`Gerado em: ${formatDateTime(data?.generatedAt)}`} variant="outlined" />
            <Chip icon={<AutorenewIcon />} label={`Crons monitorados: ${cronJobs.length}`} color="primary" variant="outlined" />
            <Chip label={`Crons com erro: ${Number(summary.cronWithError || 0)}`} color={Number(summary.cronWithError || 0) > 0 ? 'error' : 'success'} />
            <Chip label={`Retries imediatos: ${Number(summary.retryDueNow || 0)}`} color={Number(summary.retryDueNow || 0) > 0 ? 'warning' : 'success'} />
            <Chip label={`EVO: ${summary.evoOnline ? 'online' : 'offline'}`} color={summary.evoOnline ? 'success' : 'error'} />
            <Chip label={`Fuso agenda: ${timezone}`} variant="outlined" />
          </Stack>
        </CardContent>
      </Card>

      {recommendations.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>Recomendações para ajuste</Typography>
            <Stack spacing={1}>
              {recommendations.map((item, idx) => (
                <RecommendationAlert key={`${item.title || 'rec'}-${idx}`} item={item} />
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Stack spacing={1}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>Fila de retries</Typography>
                <Typography variant="body2">Failed total: <strong>{Number(retryQueue.failedTotal || 0)}</strong></Typography>
                <Typography variant="body2">Retry pendente: <strong>{Number(retryQueue.retryableTotal || 0)}</strong></Typography>
                <Typography variant="body2">Pronto para executar agora: <strong>{Number(retryQueue.retryDueNow || 0)}</strong></Typography>
                <Typography variant="body2">Exauridas (limite atingido): <strong>{Number(retryQueue.exhaustedTotal || 0)}</strong></Typography>
                <Typography variant="caption" color="text.secondary">
                  Limite: {Number(retryQueue.maxRetries || 0)} tentativas em {Number(retryQueue.retryWindowHours || 0)}h
                </Typography>
                {(retryQueue.topReasons || []).length > 0 ? (
                  <Stack spacing={0.5} sx={{ mt: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>Principais motivos de falha:</Typography>
                    {(retryQueue.topReasons || []).map((reasonItem) => (
                      <Typography key={`${reasonItem.reason}-${reasonItem.total}`} variant="caption" color="text.secondary">
                        {reasonItem.total}x - {reasonItem.reason}
                      </Typography>
                    ))}
                  </Stack>
                ) : null}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <WifiTetheringIcon />
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>EVO WhatsApp</Typography>
                </Stack>
                <Typography variant="body2">Instância: <strong>{evo.instance || '-'}</strong></Typography>
                <EvoStatusChip online={Boolean(evo.online)} connectionStatus={evo.connectionStatus} />
                <Typography variant="caption" color="text.secondary">Última checagem: {formatDateTime(evo.checkedAt)}</Typography>
                {evo.error ? <Alert severity="warning">Motivo: {evo.error}</Alert> : null}
                {evo.resolutionHint ? <Alert severity={evo.online ? 'success' : 'info'}>{evo.resolutionHint}</Alert> : null}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>Últimas execuções de cron</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Para cada job, veja o último status, erro reportado e sugestão de ajuste.
          </Typography>
          {healthQuery.isLoading ? (
            <Typography variant="body2">Carregando...</Typography>
          ) : cronJobs.length === 0 ? (
            <Typography variant="body2">Nenhum cron registrado ainda.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Job</TableCell>
                  <TableCell>Agenda</TableCell>
                  <TableCell>Último início</TableCell>
                  <TableCell>Último fim</TableCell>
                  <TableCell>Duração</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Motivo / ajuste</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {cronJobs.map((job) => (
                  <TableRow key={job.jobName} hover>
                    {(() => {
                      const schedule = describeSchedule(job.scheduleExpression);
                      return (
                        <>
                    <TableCell>
                      <Stack spacing={0.25}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{job.label || job.jobName}</Typography>
                        <Typography variant="caption" color="text.secondary">{job.jobName}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Stack spacing={0.25}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {schedule.primary}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {schedule.secondary}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Expr: {schedule.raw} | TZ: {timezone}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>{formatDateTime(job.lastStartedAt)}</TableCell>
                    <TableCell>{formatDateTime(job.lastFinishedAt)}</TableCell>
                    <TableCell>{job.status === 'running' ? `rodando há ${formatDuration(job.runningForSeconds)}` : formatDuration(job.durationSeconds)}</TableCell>
                    <TableCell><CronStatusChip status={job.status} /></TableCell>
                    <TableCell>
                      <Stack spacing={0.25}>
                        <Typography variant="caption" color={job.error ? 'error' : 'text.secondary'}>{job.error || '-'}</Typography>
                        {job.resolutionHint ? <Typography variant="caption" color="text.secondary">Sugestão: {job.resolutionHint}</Typography> : null}
                      </Stack>
                    </TableCell>
                        </>
                      );
                    })()}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>Falhas recentes de notificação</Typography>
          {(retryQueue.recentFailures || []).length === 0 ? (
            <Typography variant="body2">Sem falhas recentes na fila de notificações.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>Tipo</TableCell>
                  <TableCell>Contrato</TableCell>
                  <TableCell>Criado em</TableCell>
                  <TableCell>Retry</TableCell>
                  <TableCell>Próximo retry</TableCell>
                  <TableCell>Estado</TableCell>
                  <TableCell>Motivo</TableCell>
                  <TableCell>Ajuste sugerido</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(retryQueue.recentFailures || []).map((failure) => (
                  <TableRow key={failure.id} hover>
                    <TableCell>{failure.id}</TableCell>
                    <TableCell>{failure.type || failure.kind || '-'}</TableCell>
                    <TableCell>{failure.contractId ? `#${failure.contractId}` : '-'}</TableCell>
                    <TableCell>{formatDateTime(failure.createdAt)}</TableCell>
                    <TableCell>{failure.retryCount}/{Number(retryQueue.maxRetries || 0)}</TableCell>
                    <TableCell>{formatDateTime(failure.nextRetryAt)}</TableCell>
                    <TableCell><RetryStateChip failure={failure} /></TableCell>
                    <TableCell>
                      <Typography variant="caption" color="error">{failure.reason || '-'}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">{failure.suggestedAction || '-'}</Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}

