import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Alert, Box, Button, Chip, CircularProgress, FormControlLabel, Grid, Link, Stack, Switch,
  TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import EmailIcon from '@mui/icons-material/Email'
import SendIcon from '@mui/icons-material/Send'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import { useAuth } from '@/features/auth/AuthContext'
import { emailIntegrationService } from '@/features/companies/email.integration.service'

const EMPTY = { provider: 'smtp', host: '', port: '', user: '', from: '', secure: false, enabled: false, password: '', has_password: false }

export default function EmailConnectionPage() {
  const { selectedCompanyId, user } = useAuth()
  const enabled = useMemo(() => Number.isInteger(selectedCompanyId), [selectedCompanyId])
  const [form, setForm] = useState(EMPTY)
  const [saveResult, setSaveResult] = useState(null)
  const [testTo, setTestTo] = useState('')
  const [testResult, setTestResult] = useState(null)

  const configQuery = useQuery({
    queryKey: ['company_email_config', selectedCompanyId],
    queryFn: () => emailIntegrationService.getConfig(selectedCompanyId),
    enabled,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (configQuery.data) {
      setForm({
        provider: configQuery.data.provider || 'smtp',
        host: configQuery.data.host || '',
        port: configQuery.data.port ?? '',
        user: configQuery.data.user || '',
        from: configQuery.data.from || '',
        secure: Boolean(configQuery.data.secure),
        enabled: Boolean(configQuery.data.enabled),
        password: '',
        has_password: Boolean(configQuery.data.has_password),
      })
    }
  }, [configQuery.data])

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const saveMutation = useMutation({
    mutationFn: () => emailIntegrationService.saveConfig(selectedCompanyId, {
      provider: form.provider,
      host: form.host.trim(),
      port: form.port === '' ? null : Number(form.port),
      user: form.user.trim(),
      from: form.from.trim(),
      secure: form.secure,
      enabled: form.enabled,
      password: form.password, // vazio = mantém a senha atual
    }),
    onMutate: () => setSaveResult(null),
    onSuccess: () => {
      setSaveResult({ severity: 'success', message: 'Configuração salva.' })
      setForm((f) => ({ ...f, password: '', has_password: f.has_password || f.password.length > 0 }))
      configQuery.refetch()
    },
    onError: (err) => setSaveResult({ severity: 'error', message: err?.response?.data?.error || 'Falha ao salvar.' }),
  })

  const testMutation = useMutation({
    mutationFn: () => emailIntegrationService.sendTest(selectedCompanyId, testTo.trim()),
    onMutate: () => setTestResult(null),
    onSuccess: () => setTestResult({ severity: 'success', message: `E-mail de teste enviado para ${testTo}.` }),
    onError: (err) => setTestResult({ severity: 'error', message: err?.response?.data?.error || 'Falha ao enviar o teste.' }),
  })

  // "Conectado" = habilitado e com credenciais salvas (senha + usuário + remetente + host).
  const cfg = configQuery.data
  const isConnected = Boolean(cfg && cfg.enabled && cfg.has_password && cfg.user && cfg.from && cfg.host)
  const serverLabel = cfg?.host
    ? `${cfg.host}${cfg.port ? `:${cfg.port}` : ''}`
    : (form.provider === 'gmail' ? 'smtp.gmail.com:465' : '—')

  return (
    <Stack spacing={2}>
      <PageHeader
        title="E-mail"
        subtitle="Configure o servidor SMTP da empresa para enviar as cobranças também por e-mail, com PIX e QR Code."
      />

      {!enabled && (
        <Alert severity="info">
          Selecione uma empresa para configurar o e-mail. {user?.role === 'master' ? 'Use o seletor no menu lateral.' : ''}
        </Alert>
      )}

      {enabled && (
        <>
          <PapperBlock
            title="Status do e-mail"
            subtitle="Situação atual do envio por e-mail da empresa"
            icon={<EmailIcon />}
            iconColor={isConnected ? 'success.main' : 'warning.main'}
          >
            {configQuery.isLoading ? (
              <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={20} /><Typography variant="body2">Consultando…</Typography></Stack>
            ) : (
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Chip
                    color={isConnected ? 'success' : 'warning'}
                    variant={isConnected ? 'filled' : 'outlined'}
                    icon={isConnected ? <CheckCircleOutlineIcon /> : <ErrorOutlineIcon />}
                    label={isConnected ? 'Conectado' : 'Não configurado'}
                    sx={{ fontWeight: 700 }}
                  />
                  <Chip variant="outlined" label={(cfg?.provider || form.provider) === 'gmail' ? 'Gmail' : 'SMTP'} sx={{ fontWeight: 600 }} />
                  {isConnected && cfg?.user && <Chip variant="outlined" label={cfg.user} />}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {isConnected
                    ? `Enviando por ${serverLabel}. As cobranças (lembrete, vencimento, atraso e pagamento) também saem por e-mail para clientes com endereço cadastrado.`
                    : 'Preencha as credenciais abaixo e ative o envio para começar a enviar cobranças por e-mail.'}
                </Typography>
              </Stack>
            )}
          </PapperBlock>

          <PapperBlock title="Servidor SMTP" subtitle="Credenciais de envio de e-mail da empresa" icon={<EmailIcon />}>
            {configQuery.isLoading ? (
              <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={20} /><Typography variant="body2">Carregando…</Typography></Stack>
            ) : (
              <Stack spacing={2}>
                <ToggleButtonGroup
                  exclusive size="small" color="primary"
                  value={form.provider}
                  onChange={(_, v) => v && setForm((f) => ({ ...f, provider: v }))}
                >
                  <ToggleButton value="smtp" sx={{ px: 2.5, fontWeight: 700 }}>SMTP manual</ToggleButton>
                  <ToggleButton value="gmail" sx={{ px: 2.5, fontWeight: 700 }}>Gmail</ToggleButton>
                </ToggleButtonGroup>

                {form.provider === 'gmail' ? (
                  <>
                    <Alert severity="info">
                      Ative a <strong>verificação em 2 etapas</strong> no Google e gere uma{' '}
                      <Link href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">senha de app</Link>{' '}
                      de 16 dígitos. Use o e-mail do Gmail e essa senha abaixo — o servidor (smtp.gmail.com) é configurado automaticamente.
                    </Alert>
                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={6}>
                        <TextField fullWidth type="email" label="E-mail do Gmail" placeholder="empresa@gmail.com" value={form.user} onChange={setField('user')} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          fullWidth type="password"
                          label={form.has_password ? 'Senha de app (deixe em branco para manter)' : 'Senha de app (16 dígitos)'}
                          value={form.password}
                          onChange={setField('password')}
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <TextField fullWidth label="Remetente (opcional)" placeholder="Cobranças <empresa@gmail.com>" helperText="Em branco usa o próprio e-mail do Gmail." value={form.from} onChange={setField('from')} />
                      </Grid>
                    </Grid>
                  </>
                ) : (
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={8}>
                      <TextField fullWidth label="Servidor SMTP (host)" placeholder="smtp.seuprovedor.com" value={form.host} onChange={setField('host')} />
                    </Grid>
                    <Grid item xs={6} sm={4}>
                      <TextField fullWidth type="number" label="Porta" placeholder="587" value={form.port} onChange={setField('port')} />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField fullWidth label="Usuário" placeholder="usuario@empresa.com" value={form.user} onChange={setField('user')} />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        fullWidth type="password"
                        label={form.has_password ? 'Senha (deixe em branco para manter)' : 'Senha'}
                        value={form.password}
                        onChange={setField('password')}
                      />
                    </Grid>
                    <Grid item xs={12} sm={8}>
                      <TextField fullWidth label="Remetente (from)" placeholder="Cobranças <cobranca@empresa.com>" value={form.from} onChange={setField('from')} />
                    </Grid>
                    <Grid item xs={12} sm={4} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <FormControlLabel
                        control={<Switch checked={form.secure} onChange={(e) => setForm((f) => ({ ...f, secure: e.target.checked }))} />}
                        label="SSL (465)"
                      />
                    </Grid>
                  </Grid>
                )}
                <FormControlLabel
                  control={<Switch checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />}
                  label={form.enabled ? 'Envio por e-mail ativado' : 'Envio por e-mail desativado'}
                />
                {saveResult && <Alert severity={saveResult.severity}>{saveResult.message}</Alert>}
                <Box>
                  <Button variant="contained" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? 'Salvando…' : 'Salvar configuração'}
                  </Button>
                </Box>
              </Stack>
            )}
          </PapperBlock>

          <PapperBlock title="Enviar e-mail de teste" subtitle="Valide o SMTP enviando um e-mail agora" icon={<SendIcon />}>
            <Stack spacing={2}>
              <TextField
                label="E-mail de destino" type="email" placeholder="voce@exemplo.com"
                value={testTo} onChange={(e) => setTestTo(e.target.value)} size="small" sx={{ maxWidth: 360 }}
              />
              {testResult && <Alert severity={testResult.severity}>{testResult.message}</Alert>}
              <Box>
                <Button
                  variant="outlined" startIcon={<SendIcon />}
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending || !testTo.trim()}
                >
                  {testMutation.isPending ? 'Enviando…' : 'Enviar teste'}
                </Button>
              </Box>
            </Stack>
          </PapperBlock>
        </>
      )}
    </Stack>
  )
}
