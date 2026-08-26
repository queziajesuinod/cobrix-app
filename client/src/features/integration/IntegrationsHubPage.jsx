import React, { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Box, Button, Card, Chip, Grid, Stack, Typography, Divider } from '@mui/material'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import PixIcon from '@mui/icons-material/Pix'
import EmailIcon from '@mui/icons-material/Email'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import WebhookIcon from '@mui/icons-material/Webhook'
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet'
import EventAvailableIcon from '@mui/icons-material/EventAvailable'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import PageHeader from '@/components/PageHeader'
import { useAuth } from '@/features/auth/AuthContext'
import { companyIntegrationService } from '@/features/companies/company.integration.service'
import { emailIntegrationService } from '@/features/companies/email.integration.service'

// Categorias das integrações — usadas para o chip colorido do card.
const CATEGORY_COLOR = {
  Notificações: 'primary',
  Pagamentos: 'success',
  Crédito: 'warning',
  Fiscal: 'secondary',
  Financeiro: 'info',
  Desenvolvedor: 'default',
  Produtividade: 'default',
}

// Catálogo de integrações. `status: 'active'` já está disponível; as demais
// entram como 'soon' (Em breve) — basta trocar o status e apontar a rota/handler
// quando cada uma for implementada.
const INTEGRATIONS = [
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    category: 'Notificações',
    description: 'Envie cobranças, lembretes de vencimento e recibos automáticos pelo WhatsApp da empresa.',
    icon: <WhatsAppIcon />,
    color: '#25D366',
    status: 'active',
    to: '/integration/evo',
  },
  {
    key: 'pix-boleto',
    name: 'Pix & Boleto',
    category: 'Pagamentos',
    description: 'Gere cobranças via Pix e boleto e dê baixa automática ao receber (Asaas, Mercado Pago, Efí).',
    icon: <PixIcon />,
    color: '#32BCAD',
    status: 'soon',
    highlight: true,
  },
  {
    key: 'email',
    name: 'E-mail',
    category: 'Notificações',
    description: 'Dispare lembretes e comprovantes por e-mail (SMTP da empresa), com PIX e QR Code no template.',
    icon: <EmailIcon />,
    color: '#1976D2',
    status: 'active',
    to: '/integration/email',
  },
  {
    key: 'nfse',
    name: 'Nota Fiscal (NFS-e)',
    category: 'Fiscal',
    description: 'Emita a nota fiscal de serviço automaticamente ao confirmar o pagamento (PlugNotas, Focus NFe).',
    icon: <ReceiptLongIcon />,
    color: '#00897B',
    status: 'soon',
  },
  {
    key: 'conciliacao',
    name: 'Conciliação bancária',
    category: 'Financeiro',
    description: 'Importe o extrato via Open Finance e concilie recebimentos com os contratos em aberto.',
    icon: <AccountBalanceWalletIcon />,
    color: '#0277BD',
    status: 'soon',
  },
  {
    key: 'agenda',
    name: 'Google Agenda',
    category: 'Produtividade',
    description: 'Lance vencimentos e follow-ups de cobrança direto na agenda da equipe.',
    icon: <EventAvailableIcon />,
    color: '#4285F4',
    status: 'soon',
  },
  {
    key: 'webhooks',
    name: 'Webhooks & API',
    category: 'Desenvolvedor',
    description: 'Receba eventos (pagamento, atraso, novo contrato) e integre o GERO a sistemas próprios.',
    icon: <WebhookIcon />,
    color: '#455A64',
    status: 'soon',
  },
]

function StatusChip({ status, connected }) {
  if (status === 'active') {
    return connected
      ? <Chip size="small" color="success" label="Conectado" sx={{ fontWeight: 700 }} />
      : <Chip size="small" color="warning" variant="outlined" label="Não conectado" sx={{ fontWeight: 700 }} />
  }
  return <Chip size="small" variant="outlined" label="Em breve" sx={{ fontWeight: 700 }} />
}

function IntegrationCard({ item, connected, onOpen }) {
  const isActive = item.status === 'active'
  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease',
        opacity: isActive ? 1 : 0.92,
        ...(isActive && {
          cursor: 'pointer',
          '&:hover': {
            transform: 'translateY(-3px)',
            boxShadow: '0 12px 28px rgba(15,23,42,0.12)',
            borderColor: theme => theme.palette.primary.main,
          },
        }),
      }}
      onClick={isActive ? onOpen : undefined}
    >
      {item.highlight && !isActive && (
        <Chip
          size="small"
          color="warning"
          label="Recomendado"
          sx={{ position: 'absolute', top: 12, right: 12, fontWeight: 700 }}
        />
      )}
      <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5, flex: 1 }}>
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            bgcolor: item.color,
            boxShadow: `0 6px 16px ${item.color}55`,
          }}
        >
          {item.icon}
        </Box>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }} noWrap>{item.name}</Typography>
          </Stack>
          <Chip
            size="small"
            variant="outlined"
            color={CATEGORY_COLOR[item.category] || 'default'}
            label={item.category}
            sx={{ fontWeight: 600 }}
          />
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {item.description}
        </Typography>
      </Box>

      <Divider />
      <Box sx={{ px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <StatusChip status={item.status} connected={connected} />
        {isActive ? (
          <Button
            size="small"
            variant="contained"
            endIcon={<ArrowForwardIcon />}
            onClick={(e) => { e.stopPropagation(); onOpen() }}
          >
            {connected ? 'Gerenciar' : 'Conectar'}
          </Button>
        ) : (
          <Button size="small" variant="outlined" disabled>Em breve</Button>
        )}
      </Box>
    </Card>
  )
}

export default function IntegrationsHubPage() {
  const navigate = useNavigate()
  const { selectedCompanyId, user } = useAuth()
  const enabled = Number.isInteger(selectedCompanyId)

  // Integrações "Em breve" ainda em preparação: por ora, visíveis só ao master.
  const isMaster = user?.role === 'master'
  const visibleIntegrations = useMemo(
    () => INTEGRATIONS.filter(i => i.status === 'active' || isMaster),
    [isMaster],
  )

  // Status ao vivo do WhatsApp para refletir "Conectado" no card.
  const evoStatus = useQuery({
    queryKey: ['company_evo_status', selectedCompanyId],
    queryFn: () => companyIntegrationService.getEvoStatus(selectedCompanyId),
    enabled,
    refetchOnWindowFocus: false,
  })

  const whatsappConnected = useMemo(() => {
    const s = String(evoStatus.data?.connectionStatus || evoStatus.data?.state?.instance?.state || '').toLowerCase()
    return s === 'open'
  }, [evoStatus.data])

  // Status ao vivo do e-mail: "conectado" = habilitado e com credenciais salvas.
  const emailStatus = useQuery({
    queryKey: ['company_email_config', selectedCompanyId],
    queryFn: () => emailIntegrationService.getConfig(selectedCompanyId),
    enabled,
    refetchOnWindowFocus: false,
  })
  const emailConnected = useMemo(() => {
    const d = emailStatus.data
    return Boolean(d && d.enabled && d.has_password && d.user && d.from && d.host)
  }, [emailStatus.data])

  const connectedMap = { whatsapp: whatsappConnected, email: emailConnected }

  const activeCount = visibleIntegrations.filter(i => i.status === 'active').length
  const soonCount = visibleIntegrations.length - activeCount

  return (
    <Stack spacing={2}>
      <PageHeader
        title="Integrações"
        subtitle="Conecte o GERO às ferramentas que sua empresa já usa para automatizar cobranças, pagamentos e notificações."
      />

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip color="success" variant="outlined" label={`${activeCount} disponível`} sx={{ fontWeight: 700 }} />
        {soonCount > 0 && (
          <Chip variant="outlined" label={`${soonCount} em breve`} sx={{ fontWeight: 700 }} />
        )}
      </Stack>

      <Grid container spacing={2}>
        {visibleIntegrations.map(item => (
          <Grid item xs={12} sm={6} md={4} key={item.key}>
            <IntegrationCard
              item={item}
              connected={Boolean(connectedMap[item.key])}
              onOpen={() => item.to && navigate(item.to)}
            />
          </Grid>
        ))}
      </Grid>
    </Stack>
  )
}
