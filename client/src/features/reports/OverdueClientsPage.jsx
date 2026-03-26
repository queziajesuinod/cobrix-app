import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import PageHeader from '@/components/PageHeader';
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert';
import { useAuth } from '@/features/auth/AuthContext';
import { reportsService } from '@/features/reports/reports.service';
import { downloadCsv } from '@/utils/csv';
import { downloadExcel } from '@/utils/excel';
import { formatDateOnly } from '@/utils/date';

const DEFAULT_FILTERS = {
  q: '',
  dueDateFrom: '',
  dueDateTo: '',
  minAmount: '',
  maxAmount: '',
  minDaysLate: '',
  maxDaysLate: '',
};

function toNumberOrUndefined(value) {
  if (value == null || value === '') return undefined;
  const normalized = String(value).replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toIntOrUndefined(value) {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function sanitizeFilters(filters) {
  return {
    q: String(filters.q || '').trim() || undefined,
    dueDateFrom: filters.dueDateFrom || undefined,
    dueDateTo: filters.dueDateTo || undefined,
    minAmount: toNumberOrUndefined(filters.minAmount),
    maxAmount: toNumberOrUndefined(filters.maxAmount),
    minDaysLate: toIntOrUndefined(filters.minDaysLate),
    maxDaysLate: toIntOrUndefined(filters.maxDaysLate),
  };
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function buildExportRows(rows) {
  return (rows || []).map((row) => ({
    CobrançaId: row.billing_id,
    Cliente: row.client_name || '',
    Responsável: row.client_responsavel || '',
    Documento: row.client_document || '',
    Telefone: row.client_phone || '',
    Email: row.client_email || '',
    ContratoId: row.contract_id,
    Contrato: row.contract_description || '',
    Vencimento: formatDateOnly(row.billing_date),
    DiasEmAtraso: Number(row.days_late || 0),
    Valor: Number(row.amount || 0),
  }));
}

export default function OverdueClientsPage() {
  const queryClient = useQueryClient();
  const { selectedCompanyId, user } = useAuth();
  const enabled = Number.isInteger(selectedCompanyId);

  const [draftFilters, setDraftFilters] = useState(() => ({ ...DEFAULT_FILTERS }));
  const [appliedFilters, setAppliedFilters] = useState(() => ({ ...DEFAULT_FILTERS }));
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [exporting, setExporting] = useState(false);
  const [snack, setSnack] = useState({ open: false, severity: 'success', message: '' });

  const apiFilters = useMemo(() => sanitizeFilters(appliedFilters), [appliedFilters]);

  const listQuery = useQuery({
    queryKey: ['reports-overdue-clients', selectedCompanyId, apiFilters, page, rowsPerPage],
    queryFn: () =>
      reportsService.overdueClients({
        ...apiFilters,
        page: page + 1,
        pageSize: rowsPerPage,
      }),
    keepPreviousData: true,
    enabled,
  });

  const rows = listQuery.data?.data || [];
  const total = Number(listQuery.data?.total || 0);
  const totalOverdueAmount = Number(listQuery.data?.summary?.totalOverdueAmount || 0);
  const totalClients = Number(listQuery.data?.summary?.totalClients || 0);

  const firstBillingByClient = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.client_id)) map.set(row.client_id, row.billing_id);
    }
    return map;
  }, [rows]);

  const notifyClientMutation = useMutation({
    mutationFn: ({ clientId }) => reportsService.notifyOverdueClient(clientId, apiFilters),
    onSuccess: (result) => {
      setSnack({
        open: true,
        severity: 'success',
        message: `Notificação enviada para ${result?.clientName || 'cliente'} com ${result?.billingsCount || 0} cobrança(s).`,
      });
    },
    onError: (error) => {
      setSnack({
        open: true,
        severity: 'error',
        message: error?.response?.data?.error || error?.message || 'Falha ao enviar notificação',
      });
    },
  });

  const markClientPaidMutation = useMutation({
    mutationFn: ({ clientId }) => reportsService.markOverdueClientPaid(clientId, apiFilters),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['reports-overdue-clients'] });
      setSnack({
        open: true,
        severity: 'success',
        message: `${result?.updated || 0} cobrança(s) marcadas como pagas para o cliente.`,
      });
    },
    onError: (error) => {
      setSnack({
        open: true,
        severity: 'error',
        message: error?.response?.data?.error || error?.message || 'Falha ao marcar cobranças como pagas',
      });
    },
  });

  const markBillingPaidMutation = useMutation({
    mutationFn: ({ billingId }) => reportsService.markOverdueBillingPaid(billingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports-overdue-clients'] });
      setSnack({
        open: true,
        severity: 'success',
        message: 'Cobrança marcada como paga com sucesso.',
      });
    },
    onError: (error) => {
      setSnack({
        open: true,
        severity: 'error',
        message: error?.response?.data?.error || error?.message || 'Falha ao marcar cobrança como paga',
      });
    },
  });

  const handleFilterChange = (field) => (event) => {
    setDraftFilters((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const applyFilters = () => {
    setPage(0);
    setAppliedFilters(draftFilters);
  };

  const clearFilters = () => {
    setPage(0);
    setDraftFilters({ ...DEFAULT_FILTERS });
    setAppliedFilters({ ...DEFAULT_FILTERS });
  };

  const exportRows = async (type) => {
    if (!enabled || exporting) return;
    setExporting(true);
    try {
      const result = await reportsService.overdueClients({
        ...apiFilters,
        all: true,
        pageSize: 5000,
      });
      const dataRows = buildExportRows(result?.data || []);
      if (!dataRows.length) {
        setSnack({ open: true, severity: 'warning', message: 'Nenhum registro para exportar com os filtros atuais.' });
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      if (type === 'csv') {
        downloadCsv(`cobrancas-em-atraso-${stamp}.csv`, dataRows);
      } else {
        downloadExcel(`cobrancas-em-atraso-${stamp}.xls`, dataRows);
      }
    } catch (error) {
      setSnack({
        open: true,
        severity: 'error',
        message: error?.response?.data?.error || error?.message || 'Falha ao exportar relatório',
      });
    } finally {
      setExporting(false);
    }
  };

  const notifyClient = (row) => {
    notifyClientMutation.mutate({ clientId: row.client_id });
  };

  const markClientPaid = (row) => {
    const confirmText = `Marcar TODAS as cobranças em atraso do cliente "${row.client_name}" como pagas?`;
    if (!window.confirm(confirmText)) return;
    markClientPaidMutation.mutate({ clientId: row.client_id });
  };

  const markBillingPaid = (row) => {
    const confirmText = `Marcar a cobrança #${row.billing_id} como paga?`;
    if (!window.confirm(confirmText)) return;
    markBillingPaidMutation.mutate({ billingId: row.billing_id });
  };

  const isClientNotifying = (clientId) =>
    notifyClientMutation.isPending && Number(notifyClientMutation.variables?.clientId) === Number(clientId);

  const isClientPaying = (clientId) =>
    markClientPaidMutation.isPending && Number(markClientPaidMutation.variables?.clientId) === Number(clientId);

  const isBillingPaying = (billingId) =>
    markBillingPaidMutation.isPending && Number(markBillingPaidMutation.variables?.billingId) === Number(billingId);

  return (
    <Stack spacing={2}>
      <CompanyRequiredAlert />
      {!enabled && user?.role !== 'master' && (
        <Alert severity="info">Selecione uma empresa para visualizar as cobranças em atraso.</Alert>
      )}

      <PageHeader
        title="Cobranças em atraso"
        subtitle="Relatório de inadimplência por cobrança. Cada linha representa uma cobrança pendente vencida."
        actions={
          <>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={() => exportRows('csv')}
              disabled={!enabled || exporting}
            >
              Exportar CSV
            </Button>
            <Button
              variant="contained"
              startIcon={<DownloadIcon />}
              onClick={() => exportRows('excel')}
              disabled={!enabled || exporting}
            >
              Exportar Excel
            </Button>
          </>
        }
      />

      <Card>
        <CardContent>
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Buscar"
                placeholder="Cliente, contrato, contato, documento ou ID cobrança"
                value={draftFilters.q}
                onChange={handleFilterChange('q')}
                disabled={!enabled}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                type="date"
                label="Vencimento de"
                value={draftFilters.dueDateFrom}
                onChange={handleFilterChange('dueDateFrom')}
                InputLabelProps={{ shrink: true }}
                disabled={!enabled}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                type="date"
                label="Vencimento ate"
                value={draftFilters.dueDateTo}
                onChange={handleFilterChange('dueDateTo')}
                InputLabelProps={{ shrink: true }}
                disabled={!enabled}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                type="number"
                label="Valor mínimo"
                value={draftFilters.minAmount}
                onChange={handleFilterChange('minAmount')}
                inputProps={{ min: 0, step: '0.01' }}
                disabled={!enabled}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                type="number"
                label="Valor máximo"
                value={draftFilters.maxAmount}
                onChange={handleFilterChange('maxAmount')}
                inputProps={{ min: 0, step: '0.01' }}
                disabled={!enabled}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                type="number"
                label="Dias atraso mín."
                value={draftFilters.minDaysLate}
                onChange={handleFilterChange('minDaysLate')}
                inputProps={{ min: 0, step: '1' }}
                disabled={!enabled}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                type="number"
                label="Dias atraso máx."
                value={draftFilters.maxDaysLate}
                onChange={handleFilterChange('maxDaysLate')}
                inputProps={{ min: 0, step: '1' }}
                disabled={!enabled}
              />
            </Grid>
            <Grid item xs={12} md={8} />
            <Grid item xs={12} md={2}>
              <Button fullWidth variant="outlined" onClick={clearFilters} disabled={!enabled}>
                Limpar
              </Button>
            </Grid>
            <Grid item xs={12} md={2}>
              <Button fullWidth variant="contained" onClick={applyFilters} disabled={!enabled}>
                Aplicar filtros
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mb: 2 }}>
            <Chip label={`Cobranças em atraso: ${total}`} color="warning" />
            <Chip label={`Clientes com atraso: ${totalClients}`} color="default" variant="outlined" />
            <Chip label={`Total em aberto: ${formatCurrency(totalOverdueAmount)}`} color="error" />
          </Stack>

          {!enabled ? (
            <Alert severity="info">Selecione uma empresa para acessar os dados deste relatório.</Alert>
          ) : listQuery.isLoading ? (
            <Typography variant="body2">Carregando relatório...</Typography>
          ) : listQuery.isError ? (
            <Alert severity="error">
              {listQuery.error?.response?.data?.error || listQuery.error?.message || 'Falha ao carregar relatório'}
            </Alert>
          ) : rows.length === 0 ? (
            <Alert severity="info">Nenhuma cobrança em atraso encontrada para os filtros informados.</Alert>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Cliente</TableCell>
                  <TableCell>Contato</TableCell>
                  <TableCell>Cobrança</TableCell>
                  <TableCell>Contrato</TableCell>
                  <TableCell>Vencimento</TableCell>
                  <TableCell>Dias em atraso</TableCell>
                  <TableCell>Valor</TableCell>
                  <TableCell>Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => {
                  const showClientActions = Number(firstBillingByClient.get(row.client_id)) === Number(row.billing_id);
                  return (
                    <TableRow key={row.billing_id} hover>
                      <TableCell>
                        <Stack spacing={0.25}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {row.client_name || '-'}
                          </Typography>
                          {row.client_document && (
                            <Typography variant="caption" color="text.secondary">
                              Doc: {row.client_document}
                            </Typography>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.25}>
                          <Typography variant="caption">{row.client_phone || '-'}</Typography>
                          <Typography variant="caption">{row.client_email || '-'}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>#{row.billing_id}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">#{row.contract_id} - {row.contract_description || '-'}</Typography>
                      </TableCell>
                      <TableCell>{formatDateOnly(row.billing_date)}</TableCell>
                      <TableCell>{row.days_late}</TableCell>
                      <TableCell>{formatCurrency(row.amount)}</TableCell>
                      <TableCell>
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                          {showClientActions ? (
                            <>
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<NotificationsActiveIcon />}
                                disabled={isClientNotifying(row.client_id) || isClientPaying(row.client_id)}
                                onClick={() => notifyClient(row)}
                              >
                                Notificar atraso
                              </Button>
                              <Button
                                size="small"
                                variant="contained"
                                color="success"
                                startIcon={<TaskAltIcon />}
                                disabled={isClientNotifying(row.client_id) || isClientPaying(row.client_id)}
                                onClick={() => markClientPaid(row)}
                              >
                                Pago (todas)
                              </Button>
                            </>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              Ações do cliente na primeira linha.
                            </Typography>
                          )}
                          <Button
                            size="small"
                            variant="text"
                            color="success"
                            disabled={isBillingPaying(row.billing_id)}
                            onClick={() => markBillingPaid(row)}
                          >
                            Pago (esta)
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {enabled && (
            <TablePagination
              component="div"
              count={total}
              page={page}
              onPageChange={(_, newPage) => setPage(newPage)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(event) => {
                setRowsPerPage(parseInt(event.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[10, 20, 50, 100]}
            />
          )}
        </CardContent>
      </Card>

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack((prev) => ({ ...prev, open: false }))}
      >
        <Alert
          severity={snack.severity}
          variant="filled"
          onClose={() => setSnack((prev) => ({ ...prev, open: false }))}
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
