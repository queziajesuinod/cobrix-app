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
          <PapperBlock title="Revenda do parceiro" icon={<HandshakeIcon />} iconColor="primary.main">
            <PartnerPlanPrices companyId={selectedCompanyId} />
          </PapperBlock>
          <PapperBlock title="Cupons de desconto" icon={<LocalOfferIcon />} iconColor="secondary.main">
            <PartnerCoupons />
          </PapperBlock>
        </Stack>
      )}
    </>
  )
}
