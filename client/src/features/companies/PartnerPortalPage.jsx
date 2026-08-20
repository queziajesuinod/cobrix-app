import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, CircularProgress, Stack } from '@mui/material'
import HandshakeIcon from '@mui/icons-material/Handshake'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import PageHeader from '@/components/PageHeader'
import PapperBlock from '@/components/PapperBlock'
import CompanyRequiredAlert from '@/components/CompanyRequiredAlert'
import { useAuth } from '@/features/auth/AuthContext'
import { companyService } from './company.service'
import PartnerPlanPrices from './PartnerPlanPrices'
import PartnerCoupons from '@/features/commissions/PartnerCoupons'
import LocalOfferIcon from '@mui/icons-material/LocalOffer'

const fmtDate = (v) => {
  if (!v) return ''
  const s = String(v).slice(0, 10)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s
}

// Banner do estado de revenda (inadimplência da comissão que o parceiro repassa à
// plataforma). Separado do acesso ao sistema — travar revenda não tira o login.
function ResellerStatusBanner({ status, since }) {
  if (status === 'network_seized') {
    return (
      <Alert severity="error">
        <strong>Revenda suspensa por inadimplência.</strong> As comissões da sua rede estão sendo direcionadas à plataforma
        e seus sub-parceiros foram movidos para ela. Quite a comissão em aberto para reativar tudo — a reversão é imediata.
      </Alert>
    )
  }
  if (status === 'link_locked') {
    return (
      <Alert severity="warning">
        <strong>Revenda bloqueada por inadimplência.</strong> Seu link de indicação está desativado e sub-parceiros ligados
        à comissão em atraso podem ter sido movidos à plataforma. Quite para reativar — a reversão é imediata.
      </Alert>
    )
  }
  if (since) {
    return (
      <Alert severity="info">
        Você tem <strong>comissão de revenda em aberto</strong> desde {fmtDate(since)}. Regularize em até 3 meses para não
        bloquear sua revenda.
      </Alert>
    )
  }
  return null
}

// Portal self-service do PARCEIRO: link de indicação, preços de revenda e atalho
// para as comissões — tudo da empresa atualmente selecionada, sem depender do master.
export default function PartnerPortalPage() {
  const navigate = useNavigate()
  const { selectedCompanyId } = useAuth()

  const companyQ = useQuery({
    queryKey: ['partner-portal-company', selectedCompanyId],
    queryFn: () => companyService.get(selectedCompanyId),
    enabled: Boolean(selectedCompanyId),
  })

  if (!selectedCompanyId) return <CompanyRequiredAlert />

  const isPartner = Boolean(companyQ.data?.is_partner)
  const resellerStatus = companyQ.data?.reseller_status || 'active'
  const delinquentSince = companyQ.data?.reseller_delinquent_since || null

  return (
    <>
      <PageHeader
        title="Revenda"
        subtitle="Seu link de indicação, seus preços por plano e suas comissões."
        actions={<Button variant="outlined" startIcon={<ReceiptLongIcon />} onClick={() => navigate('/commissions')}>Ver comissões</Button>}
      />

      {companyQ.isLoading ? (
        <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress /></Stack>
      ) : !isPartner ? (
        <Alert severity="info">
          Esta empresa não é uma parceira de revenda. Fale com o administrador da plataforma para se tornar um parceiro.
        </Alert>
      ) : (
        <Stack spacing={2}>
          <ResellerStatusBanner status={resellerStatus} since={delinquentSince} />
          <PapperBlock title="Revenda do parceiro" icon={<HandshakeIcon />} iconColor="primary.main">
            <PartnerPlanPrices companyId={selectedCompanyId} resellerStatus={resellerStatus} />
          </PapperBlock>
          <PapperBlock title="Cupons de desconto" icon={<LocalOfferIcon />} iconColor="secondary.main">
            <PartnerCoupons />
          </PapperBlock>
        </Stack>
      )}
    </>
  )
}
