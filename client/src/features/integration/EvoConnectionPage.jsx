import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Box, Button, Card, CardContent, Stack, Typography, Alert, CircularProgress, Divider, IconButton, Tooltip } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import QrCodeIcon from '@mui/icons-material/QrCode'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import PageHeader from '@/components/PageHeader'
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

export default function EvoConnectionPage() {
  const { selectedCompanyId, user } = useAuth()
  const [qrPayload, setQrPayload] = useState(null)
  const [errorMessage, setErrorMessage] = useState(null)
  const [qrCountdown, setQrCountdown] = useState(null)

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
  const shouldPollQr = enabled && !isConnected

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

  useEffect(() => {
    setQrPayload(null)
    setQrCountdown(null)
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
        subtitle="Conecte o WhatsApp da empresa ao Cobrix. Utilize esta tela para gerar um novo QR Code sempre que a conexão cair."
      />

      {!enabled && (
        <Alert severity="info">
          Selecione uma empresa para gerenciar a conexão. {user?.role === 'master' ? 'Use o seletor no menu lateral.' : ''}
        </Alert>
      )}

      {enabled && (
        <>
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>Resumo da instância</Typography>
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
                    <Typography variant="body2">Instância: <strong>{instanceName}</strong></Typography>
                    <Typography variant="body2">Status: <strong>{connectionStatus.toUpperCase()}</strong></Typography>
                    <Alert severity={isConnected ? 'success' : 'warning'} icon={isConnected ? <CheckCircleOutlineIcon fontSize="inherit" /> : <ErrorOutlineIcon fontSize="inherit" />}>
                      {isConnected
                        ? 'O WhatsApp está conectado. Nenhuma ação é necessária agora.'
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
                  {isClosed ? (
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
                  )}
                </Stack>
              </Stack>
            </CardContent>
          </Card>

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
            <Card variant="outlined">
              <CardContent>
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="h6" sx={{ fontWeight: 600, flexGrow: 1 }}>Escaneie para conectar</Typography>
                    {qrQuery.isFetching && <CircularProgress size={18} />}
                  </Stack>
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
              </CardContent>
            </Card>
          )}



          {!qrPayload?.qrcode && !isConnected && !(restartMutation.isPending || connectMutation.isPending) && (
            <Alert severity="warning">
              Gere um QR Code e escaneie para finalizar a conexão.
            </Alert>
          )}

     
        </>
      )}
    </Stack>
  )
}
