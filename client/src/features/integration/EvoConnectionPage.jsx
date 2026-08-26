import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Box, Button, Stack, Typography, Alert, CircularProgress, Divider, IconButton, Tooltip, TextField } from '@mui/material'
import AddLinkIcon from '@mui/icons-material/AddLink'
import RefreshIcon from '@mui/icons-material/Refresh'
import QrCodeIcon from '@mui/icons-material/QrCode'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import LinkIcon from '@mui/icons-material/Link'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import { useAuth } from '@/features/auth/AuthContext'
import { companyIntegrationService } from '@/features/companies/company.integration.service'

function QrCodeViewer({ base64 }) {
  if (!base64) return null
  const src = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`
  return (
    <Box sx={{ py: 2 }}>
      <img src={src} alt="QR Code WhatsApp" style={{ maxWidth: '280px', width: '100%', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }} />
    </Box>
  )
}

const TEST_NUMBER = '5567992625560'
const TEST_MESSAGE = '🔄 Teste de conexão GERO: se você recebeu esta mensagem, o WhatsApp da empresa está pronto para enviar notificações automáticas.'

export default function EvoConnectionPage() {
  const { selectedCompanyId, user } = useAuth()
  const [qrPayload, setQrPayload] = useState(null)
  const [errorMessage, setErrorMessage] = useState(null)
  const [qrCountdown, setQrCountdown] = useState(null)
  const [testResult, setTestResult] = useState(null)
  const [newInstanceName, setNewInstanceName] = useState('')

  const enabled = useMemo(() => Number.isInteger(selectedCompanyId), [selectedCompanyId])

  const statusQuery = useQuery({
    queryKey: ['company_evo_status', selectedCompanyId],
    queryFn: () => companyIntegrationService.getEvoStatus(selectedCompanyId),
    enabled,
    refetchOnWindowFocus: false,
    refetchInterval: (data) => {
      const status = String(data?.connectionStatus || data?.state?.instance?.state || '').toLowerCase()
      return status && status !== 'open' ? 5000 : false
    },
  })
  const [showPollingStatus, setShowPollingStatus] = useState(false)

  const connectionStatus = statusQuery.data?.connectionStatus || statusQuery.data?.state?.instance?.state || 'unknown'
  const connectionStatusLower = String(connectionStatus || '').toLowerCase()
  const isConnected = connectionStatusLower === 'open'
  const isClosed = connectionStatusLower === 'close' || connectionStatusLower === 'closed'
  // Empresa sem instância criada (ex.: provisionada pelo signup público).
  const isMissing = connectionStatusLower === 'missing' || statusQuery.data?.instance === null
  const shouldPollQr = enabled && !isConnected && !isMissing

  const qrQuery = useQuery({
    queryKey: ['company_evo_qr', selectedCompanyId],
    queryFn: () => companyIntegrationService.getEvoQrCode(selectedCompanyId),
    enabled: shouldPollQr,
    refetchOnWindowFocus: false,
    refetchInterval: shouldPollQr ? 20000 : false,
  })

  const restartMutation = useMutation({
    mutationFn: () => companyIntegrationService.restartInstance(selectedCompanyId),
    onMutate: () => {
      setErrorMessage(null)
    },
    onSuccess: (data) => {
      setQrPayload({
        qrcode: data?.qrcode ?? data?.data?.qrcode ?? null,
        code: data?.code ?? null,
        pairingCode: data?.pairingCode ?? null,
        raw: data?.data || data || null,
      })
      setErrorMessage(null)
      statusQuery.refetch()
    },
    onError: (err) => {
      setErrorMessage(err?.response?.data?.error || err?.message || 'Falha ao gerar QR Code')
    }
  })

  const connectMutation = useMutation({
    mutationFn: () => companyIntegrationService.connectInstance(selectedCompanyId),
    onMutate: () => {
      setErrorMessage(null)
    },
    onSuccess: (data) => {
      setQrPayload({
        qrcode: data?.qrcode ?? data?.data?.qrcode ?? null,
        code: data?.code ?? null,
        pairingCode: data?.pairingCode ?? null,
        raw: data?.data || data || null,
      })
      setErrorMessage(null)
      statusQuery.refetch()
    },
    onError: (err) => {
      setErrorMessage(err?.response?.data?.error || err?.message || 'Falha ao gerar QR Code')
    }
  })
  const createMutation = useMutation({
    mutationFn: () => companyIntegrationService.createInstance(selectedCompanyId, newInstanceName.trim() || undefined),
    onMutate: () => { setErrorMessage(null) },
    onSuccess: () => {
      setNewInstanceName('')
      statusQuery.refetch()
    },
    onError: (err) => {
      setErrorMessage(err?.response?.data?.error || err?.message || 'Falha ao criar a instância.')
    },
  })
  const testMutation = useMutation({
    mutationFn: () => companyIntegrationService.testEvo(selectedCompanyId, {
      number: TEST_NUMBER,
      text: TEST_MESSAGE,
    }),
    onMutate: () => {
      setTestResult(null)
    },
    onSuccess: () => {
      setTestResult({
        severity: 'success',
        message: `Mensagem de teste enviada para ${TEST_NUMBER}. Verifique o WhatsApp para confirmar o recebimento.`,
        at: new Date(),
      })
    },
    onError: (err) => {
      setTestResult({
        severity: 'error',
        message: err?.response?.data?.error || err?.message || 'Falha ao enviar a mensagem de teste.',
        at: new Date(),
      })
    }
  })

  useEffect(() => {
    setQrPayload(null)
    setQrCountdown(null)
    setTestResult(null)
  }, [selectedCompanyId])

  useEffect(() => {
    if (qrQuery.data?.qrcode || qrQuery.data?.pairingCode || qrQuery.data?.code) {
      setQrPayload({
        qrcode: qrQuery.data?.qrcode ?? null,
        code: qrQuery.data?.code ?? null,
        pairingCode: qrQuery.data?.pairingCode ?? null,
        fetchedAt: Date.now(),
        raw: qrQuery.data?.data || qrQuery.data || null,
      })
    }
  }, [qrQuery.data])

  const instanceName = statusQuery.data?.instance || 'N/D'

  useEffect(() => {
    if (isConnected) setQrPayload(null)
  }, [isConnected])

  useEffect(() => {
    if (qrPayload?.qrcode && !isConnected) {
      setQrCountdown(29)
    } else {
      setQrCountdown(null)
    }
  }, [qrPayload?.qrcode, isConnected])

  useEffect(() => {
    if (qrCountdown == null || qrCountdown <= 0) return undefined
    const timer = setInterval(() => {
      setQrCountdown(prev => (prev != null ? prev - 1 : null))
    }, 1000)
    return () => clearInterval(timer)
  }, [qrCountdown])

  useEffect(() => {
    if (!isClosed || !qrPayload?.qrcode || connectMutation.isPending) return undefined
    const timer = setTimeout(() => {
      connectMutation.mutate()
    }, 20000)
    return () => clearTimeout(timer)
  }, [isClosed, qrPayload?.qrcode, connectMutation])

  useEffect(() => {
    if (isConnected) return
    const id = setInterval(() => statusQuery.refetch(), 5000)
    return () => clearInterval(id)
  }, [qrPayload?.qrcode, qrCountdown, isConnected, statusQuery])

  useEffect(() => {
    if (!qrPayload?.qrcode || isConnected || qrCountdown == null) return
    if (qrCountdown <= 0 && !connectMutation.isPending) {
      connectMutation.mutate()
    }
  }, [qrCountdown, qrPayload?.qrcode, isConnected, connectMutation])

  const fallbackSegments = useMemo(() => {
    if (!qrPayload?.code) return []
    return String(qrPayload.code)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  }, [qrPayload?.code])

  const copyText = (text) => {
    if (!text) return
    navigator?.clipboard?.writeText(text).catch(()=>{})
  }

  return (
    <Stack spacing={2}>
      <PageHeader
        title="WhatsApp"
        subtitle="Conecte o WhatsApp da empresa ao GERO. Utilize esta tela para gerar um novo QR Code sempre que a conexão cair."
      />

      {!enabled && (
        <Alert severity="info">
          Selecione uma empresa para gerenciar a conexão. {user?.role === 'master' ? 'Use o seletor no menu lateral.' : ''}
        </Alert>
      )}

      {enabled && (
        <>
          <PapperBlock
            title="Resumo da instância"
            subtitle="Situação atual da conexão do WhatsApp da empresa"
            icon={<LinkIcon />}
            iconColor={isConnected ? 'success.main' : 'warning.main'}
          >
            <Stack spacing={2}>
                {statusQuery.isLoading ? (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <CircularProgress size={20} />
                    <Typography variant="body2">Consultando status…</Typography>
                  </Stack>
                ) : statusQuery.error ? (
                  <Alert severity="error">
                    {statusQuery.error?.response?.data?.error || statusQuery.error?.message || 'Falha ao consultar status.'}
                  </Alert>
                ) : (
                  <Stack spacing={1}>
                    <Typography variant="body2">Instância: <strong>{isMissing ? 'não criada' : instanceName}</strong></Typography>
                    <Typography variant="body2">Status: <strong>{connectionStatus.toUpperCase()}</strong></Typography>
                    <Alert severity={isConnected ? 'success' : 'warning'} icon={isConnected ? <CheckCircleOutlineIcon fontSize="inherit" /> : <ErrorOutlineIcon fontSize="inherit" />}>
                      {isConnected
                        ? 'O WhatsApp está conectado. Nenhuma ação é necessária agora.'
                        : isMissing
                          ? 'Esta empresa ainda não tem uma instância. Crie uma no bloco abaixo para conectar o WhatsApp.'
                          : 'O WhatsApp NÃO está conectado. Gere um novo QR Code e escaneie com o app da empresa.'}
                    </Alert>
                  </Stack>
                )}

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <Button
                    variant="contained"
                    startIcon={<RefreshIcon />}
                    onClick={() => statusQuery.refetch()}
                    disabled={statusQuery.isLoading}
                  >
                    Atualizar status
                  </Button>
                  {!isMissing && (isClosed ? (
                    <Button
                      variant="outlined"
                      startIcon={<QrCodeIcon />}
                      onClick={() => connectMutation.mutate()}
                      disabled={connectMutation.isPending || statusQuery.isLoading}
                      color="primary"
                    >
                      Gerar QR Code inicial
                    </Button>
                  ) : (
                    <Button
                      variant="outlined"
                      startIcon={<QrCodeIcon />}
                      onClick={() => restartMutation.mutate()}
                      disabled={restartMutation.isPending || statusQuery.isLoading}
                      color="primary"
                    >
                      {isConnected ? 'Gerar QR Code mesmo assim' : 'Reiniciar conexão'}
                    </Button>
                  ))}
                  {!isMissing && (
                    <Tooltip
                      title={isConnected ? 'Envia uma mensagem automática para validar o WhatsApp' : 'Conecte o WhatsApp antes de testar o envio'}
                    >
                      <span>
                        <Button
                          variant="outlined"
                          color="secondary"
                          onClick={() => testMutation.mutate()}
                          disabled={!isConnected || testMutation.isPending}
                        >
                          {testMutation.isPending ? 'Enviando teste…' : 'Enviar msg de teste'}
                        </Button>
                      </span>
                    </Tooltip>
                  )}
                </Stack>
                {testResult && (
                  <Alert severity={testResult.severity} sx={{ mt: 1 }}>
                    {testResult.message}
                  </Alert>
                )}
            </Stack>
          </PapperBlock>

          {isMissing && !statusQuery.isLoading && (
            <PapperBlock
              title="Criar instância do WhatsApp"
              subtitle="Esta empresa ainda não tem uma instância. Crie uma para gerar o QR Code e conectar o WhatsApp."
              icon={<AddLinkIcon />}
              iconColor="primary.main"
            >
              <Stack spacing={2}>
                <Alert severity="info">
                  Empresas cadastradas pela página de assinatura não têm a instância criada automaticamente. Clique abaixo para criar agora.
                </Alert>
                <TextField
                  label="Nome da instância (opcional)"
                  helperText="Deixe em branco para gerar automaticamente a partir do nome da empresa."
                  value={newInstanceName}
                  onChange={(e) => setNewInstanceName(e.target.value)}
                  size="small"
                  fullWidth
                />
                <Box>
                  <Button
                    variant="contained"
                    startIcon={<AddLinkIcon />}
                    onClick={() => createMutation.mutate()}
                    disabled={createMutation.isPending}
                  >
                    {createMutation.isPending ? 'Criando…' : 'Criar instância'}
                  </Button>
                </Box>
              </Stack>
            </PapperBlock>
          )}

          {(restartMutation.isPending || connectMutation.isPending) && (
            <Alert severity="info">Solicitando QR Code…</Alert>
          )}

          {errorMessage && !restartMutation.isPending && (
            <Alert severity="error">{errorMessage}</Alert>
          )}

          {qrQuery.isError && shouldPollQr && qrQuery.error?.response?.status !== 404 && (
            <Alert severity="warning">
              {qrQuery.error?.response?.data?.error || qrQuery.error?.message || 'Falha ao buscar QR Code. Tente novamente.'}
            </Alert>
          )}

          {qrPayload?.qrcode && !(restartMutation.isPending || connectMutation.isPending) && (
            <PapperBlock
              title="Escaneie para conectar"
              subtitle="Leia o QR Code com o WhatsApp Business da empresa"
              icon={<QrCodeIcon />}
              iconColor="primary.main"
              action={qrQuery.isFetching ? <CircularProgress size={18} /> : null}
            >
                <Stack spacing={1}>
                  {qrCountdown != null && (
                    <Typography variant="caption" color="text.secondary">
                      QR expira em {Math.max(qrCountdown, 0)}s
                    </Typography>
                  )}
                  <Typography variant="body2" color="text.secondary">
                    Abra o WhatsApp Business no celular da empresa → Configurações → Dispositivos conectados → Conectar um dispositivo.
                  </Typography>
                  <QrCodeViewer base64={qrPayload.qrcode} />
                  {qrPayload.pairingCode && (
                    <>
                      <Divider />
                      <Typography variant="body2">
                        Código de pareamento: <strong>{qrPayload.pairingCode}</strong>
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Os códigos são atualizados automaticamente enquanto a conexão não está ativa.
                      </Typography>
                    </>
                  )}
                </Stack>
            </PapperBlock>
          )}



          {!qrPayload?.qrcode && !isConnected && !isMissing && !(restartMutation.isPending || connectMutation.isPending) && (
            <Alert severity="warning">
              Gere um QR Code e escaneie para finalizar a conexão.
            </Alert>
          )}

     
        </>
      )}
    </Stack>
  )
}
