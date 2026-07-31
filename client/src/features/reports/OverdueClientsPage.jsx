import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '@/components/ConfirmDialog';
import { usePermissions } from '@/features/permissions/PermissionsContext';
import { useSensitive } from '@/features/permissions/useSensitive';
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  Skeleton,
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
import FilterListIcon from '@mui/icons-material/FilterList';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import PapperBlock from '@/components/PapperBlock';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
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
  const confirm = useConfirm();
  const { can } = usePermissions();
  const { money, phone, canValues } = useSensitive();
  const canNotify = can('billings.notify');
  const canMarkPaid = can('billings.markPaid');
  const canExport = can('reports.export');
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

  const markClientPaid = async (row) => {
    const ok = await confirm({
      title: 'Marcar cliente como pago',
      description: `Marcar TODAS as cobranças em atraso do cliente "${row.client_name}" como pagas?`,
      confirmText: 'Marcar como pago',
      color: 'success',
    });
    if (!ok) return;
    markClientPaidMutation.mutate({ clientId: row.client_id });
  };

  const markBillingPaid = async (row) => {
    const ok = await confirm({
      title: 'Marcar cobrança como paga',
      description: `Marcar a cobrança #${row.billing_id} como paga?`,
      confirmText: 'Marcar como pago',
      color: 'success',
    });
    if (!ok) return;
    markBillingPaidMutation.mutate({ billingId: row.billing_id });
  };

  const isClientNotifying = (clientId) =>
    notifyClientMutation.isPending && Number(notifyClientMutation.variables?.clientId) === Number(clientId);

  const isClientPaying = (clientId) =>
    markClientPaidMutation.isPending && Number(markClientPaidMutation.variables?.clientId) === Number(clientId);

  const isBillingPaying = (billingId) =>
    markBillingPaidMutation.isPending && Number(markBillingPaidMutation.variables?.billingId) === Number(billingId);

  // Agrupa as cobranças da página atual por cliente.
  const groups = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const key = row.client_id ?? `n:${row.client_name}`;
      if (!map.has(key)) {
        map.set(key, {
          client_id: row.client_id,
          client_name: row.client_name,
          client_document: row.client_document,
          client_phone: row.client_phone,
          client_email: row.client_email,
          billings: [],
        });
      }
      map.get(key).billings.push(row);
    }
    return Array.from(map.values()).map((g) => ({
      ...g,
      count: g.billings.length,
      totalAmount: g.billings.reduce((s, b) => s + Number(b.amount || 0), 0),
      maxDaysLate: g.billings.reduce((mx, b) => Math.max(mx, Number(b.days_late || 0)), 0),
    }));
  }, [rows]);

  const [expandedClients, setExpandedClients] = useState(() => new Set());
  const toggleClient = (id) => setExpandedClients((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const expandAllClients = () => setExpandedClients(new Set(groups.map((g) => g.client_id)));
  const collapseAllClients = () => setExpandedClients(new Set());

  return (
    <Stack spacing={2}>
      <CompanyRequiredAlert />
      {!enabled && user?.role !== 'master' && (
        <Alert severity="info">Selecione uma empresa para visualizar as cobranças em atraso.</Alert>
      )}

      <PageHeader
        title="Inadimplentes"
        subtitle="Relatório de inadimplência agrupado por cliente."
        actions={canExport ? (
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
        ) : null}
      />

      <Alert severity="info" icon={<WarningAmberIcon />}>
        Esta tela lista os <strong>inadimplentes</strong>: clientes com cobranças pendentes vencidas há <strong>mais de 30 dias</strong>.
        Cobranças com menos de 30 dias de atraso ainda não aparecem aqui.
      </Alert>

      <PapperBlock title="Filtros" icon={<FilterListIcon />} iconColor="info.main">
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
            {canValues && (
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
            )}
            {canValues && (
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
            )}
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
      </PapperBlock>

      <PapperBlock
        title="Cobranças em atraso"
        subtitle="Agrupado por cliente — expanda para ver as cobranças."
        icon={<WarningAmberIcon />}
        iconColor="error.main"
        noPadding
      >
        <Box sx={{ px: 2, pt: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mb: 2 }}>
            <Chip label={`Cobranças em atraso: ${total}`} color="warning" />
            <Chip label={`Clientes com atraso: ${totalClients}`} color="default" variant="outlined" />
            <Chip label={`Total em aberto: ${money(totalOverdueAmount)}`} color="error" />
          </Stack>
        </Box>

        <Box sx={{ px: 2, pb: 1 }}>
          {!enabled ? (
            <Alert severity="info">Selecione uma empresa para acessar os dados deste relatório.</Alert>
          ) : listQuery.isError ? (
            <Alert severity="error">
              {listQuery.error?.response?.data?.error || listQuery.error?.message || 'Falha ao carregar relatório'}
            </Alert>
          ) : listQuery.isLoading ? (
            <Stack spacing={1}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} variant="rounded" height={60} />
              ))}
            </Stack>
          ) : groups.length === 0 ? (
            <EmptyState
              icon={<WarningAmberIcon />}
              title="Nenhuma cobrança em atraso"
              description="Ajuste os filtros ou confirme o período."
            />
          ) : (
            <>
              <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mb: 1 }}>
                <Button size="small" startIcon={<UnfoldMoreIcon />} onClick={expandAllClients}>Expandir todos</Button>
                <Button size="small" startIcon={<UnfoldLessIcon />} onClick={collapseAllClients}>Recolher todos</Button>
              </Stack>
              <Stack spacing={1}>
                {groups.map((g) => (
                  <Accordion
                    key={g.client_id}
                    disableGutters
                    TransitionProps={{ unmountOnExit: true }}
                    expanded={expandedClients.has(g.client_id)}
                    onChange={() => toggleClient(g.client_id)}
                    sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', boxShadow: 'none', '&:before': { display: 'none' } }}
                  >
                    <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ '& .MuiAccordionSummary-content': { my: 1, alignItems: 'center' } }}>
                      <Grid container alignItems="center" spacing={1} sx={{ pr: 1 }}>
                        <Grid item xs={12} md={6}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>
                            {g.client_name || 'Cliente'}
                          </Typography>
                          {g.client_document && (
                            <Typography variant="caption" color="text.secondary">Doc: {g.client_document}</Typography>
                          )}
                        </Grid>
                        <Grid item xs={12} md={6}>
                          <Stack direction="row" spacing={0.5} justifyContent={{ xs: 'flex-start', md: 'flex-end' }} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                            <Chip size="small" color="warning" label={`${g.count} cobrança${g.count > 1 ? 's' : ''}`} />
                            <Chip size="small" color="error" label={`Total ${money(g.totalAmount)}`} />
                            <Chip size="small" variant="outlined" color="error" label={`${g.maxDaysLate} dias de inadimplência`} />
                          </Stack>
                        </Grid>
                      </Grid>
                    </AccordionSummary>
                    <AccordionDetails sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1.5, alignItems: { sm: 'center' } }}>
                        <Typography variant="caption" color="text.secondary">
                          {phone(g.client_phone)} · {(g.client_email || '—')}
                        </Typography>
                        <Box sx={{ flexGrow: 1 }} />
                        {canNotify && (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<NotificationsActiveIcon />}
                            disabled={isClientNotifying(g.client_id) || isClientPaying(g.client_id)}
                            onClick={() => notifyClient({ client_id: g.client_id })}
                          >
                            Notificar atraso
                          </Button>
                        )}
                        {canMarkPaid && (
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            startIcon={<TaskAltIcon />}
                            disabled={isClientNotifying(g.client_id) || isClientPaying(g.client_id)}
                            onClick={() => markClientPaid({ client_id: g.client_id, client_name: g.client_name })}
                          >
                            Pago (todas)
                          </Button>
                        )}
                      </Stack>
                      <Box sx={{ overflow: 'auto', maxHeight: { xs: 320, md: 400 } }}>
                        <Table stickyHeader size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Cobrança</TableCell>
                              <TableCell>Contrato</TableCell>
                              <TableCell>Vencimento</TableCell>
                              <TableCell>Dias em atraso</TableCell>
                              <TableCell>Valor</TableCell>
                              <TableCell align="right">Ação</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {g.billings.map((b) => (
                              <TableRow key={b.billing_id} hover>
                                <TableCell>
                                  <Typography variant="body2" sx={{ fontWeight: 600 }}>#{b.billing_id}</Typography>
                                </TableCell>
                                <TableCell>#{b.contract_id} - {b.contract_description || '-'}</TableCell>
                                <TableCell>{formatDateOnly(b.billing_date)}</TableCell>
                                <TableCell>{b.days_late}</TableCell>
                                <TableCell>{money(b.amount)}</TableCell>
                                <TableCell align="right">
                                  {canMarkPaid ? (
                                    <Button
                                      size="small"
                                      variant="text"
                                      color="success"
                                      disabled={isBillingPaying(b.billing_id)}
                                      onClick={() => markBillingPaid(b)}
                                    >
                                      Pago (esta)
                                    </Button>
                                  ) : (
                                    <Typography variant="caption" color="text.secondary">—</Typography>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                ))}
              </Stack>
            </>
          )}
        </Box>

        {enabled && (
          <Box sx={{ px: 2 }}>
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
          </Box>
        )}
      </PapperBlock>

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
