import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Alert, Box, Button, Card, Chip, CircularProgress, Container, Divider, Grid,
  Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { publicService } from './public.service'

const qrSrc = (v) => !v ? null : (String(v).startsWith('data:') ? v : `data:image/png;base64,${v}`)

const BRL = (v) => v == null
  ? null
  : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const EMPTY = { company_name: '', admin_name: '', admin_email: '', admin_password: '', document: '', phone: '', code: '' }

function PlanCard({ plan, period, selected, onSelect }) {
  // Tanto o campo mensal quanto o anual guardam o valor POR MÊS; no anual a
  // cobrança é única (12x esse valor, paga uma vez ao ano).
  const monthly = period === 'annual' ? plan.price_annual : plan.price_monthly
  const available = monthly != null
  const annualTotal = period === 'annual' && monthly != null ? Number(monthly) * 12 : null
  return (
    <Card
      onClick={available ? onSelect : undefined}
      sx={{
        p: 2.5, height: '100%', display: 'flex', flexDirection: 'column', gap: 1,
        cursor: available ? 'pointer' : 'not-allowed',
        opacity: available ? 1 : 0.55,
        border: '2px solid',
        borderColor: selected ? 'primary.main' : 'divider',
        boxShadow: selected ? '0 8px 24px rgba(32,101,209,0.18)' : undefined,
        transition: 'border-color .15s ease, box-shadow .15s ease',
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h6" sx={{ fontWeight: 700 }}>{plan.name}</Typography>
        {selected && <Chip size="small" color="primary" icon={<CheckIcon />} label="Selecionado" sx={{ fontWeight: 700 }} />}
      </Stack>
      {plan.description && <Typography variant="body2" color="text.secondary">{plan.description}</Typography>}
      <Box sx={{ mt: 1 }}>
        {available ? (
          <>
            <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1.1 }}>{BRL(monthly)}</Typography>
            <Typography variant="caption" color="text.secondary" display="block">por mês</Typography>
            {period === 'annual' && (
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.main' }}>
                cobrado {BRL(annualTotal)} 1×/ano
              </Typography>
            )}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">Indisponível no {period === 'annual' ? 'anual' : 'mensal'}</Typography>
        )}
      </Box>
      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mt: 'auto', pt: 1 }}>
        <Chip size="small" variant="outlined" label={plan.clients_limit == null ? 'Clientes ilimitados' : `${plan.clients_limit} clientes`} />
        <Chip size="small" variant="outlined" label={plan.contracts_limit == null ? 'Contratos ilimitados' : `${plan.contracts_limit} contratos`} />
      </Stack>
    </Card>
  )
}

export default function SignupPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Link de revenda: /signup?parceiro=<id> → preços e recebimento vão para o parceiro.
  const partnerId = searchParams.get('parceiro') || null
  const [period, setPeriod] = useState('monthly')
  const [planId, setPlanId] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState(null)

  const plansQuery = useQuery({
    queryKey: ['public-plans', partnerId],
    queryFn: () => publicService.plans(partnerId ? { partner_id: partnerId } : {}),
  })
  const plans = plansQuery.data?.plans || []

  const selectedPlan = useMemo(() => plans.find((p) => p.id === planId) || null, [plans, planId])
  const selectedMonthly = selectedPlan ? (period === 'annual' ? selectedPlan.price_annual : selectedPlan.price_monthly) : null
  const selectedCharge = selectedMonthly == null ? null : (period === 'annual' ? Number(selectedMonthly) * 12 : Number(selectedMonthly))

  const signup = useMutation({
    mutationFn: (payload) => publicService.signup(payload),
    onError: (err) => setError(err?.response?.data?.error || 'Falha ao concluir a inscrição.'),
  })

  // Cupom: valida ao vivo contra o plano/período selecionados.
  const [couponResult, setCouponResult] = useState(null)
  const validateCoupon = useMutation({
    mutationFn: (payload) => publicService.validateCoupon(payload),
    onSuccess: (d) => setCouponResult(d),
    onError: (err) => setCouponResult({ valid: false, message: err?.response?.data?.message || 'Falha ao validar o cupom.' }),
  })

  // Trocar plano/período invalida um cupom já aplicado (preço muda / elegibilidade).
  useEffect(() => { setCouponResult(null) }, [planId, period])

  const handleApplyCoupon = () => {
    const code = form.code.trim()
    if (!code) { setCouponResult({ valid: false, message: 'Digite um código de cupom.' }); return }
    if (!selectedPlan) { setCouponResult({ valid: false, message: 'Selecione um plano primeiro.' }); return }
    validateCoupon.mutate({ code, plan_id: selectedPlan.id, period, partner_id: partnerId || null })
  }

  // Valor efetivo a cobrar agora (com desconto do cupom, se válido).
  const chargeNow = couponResult?.valid ? Number(couponResult.final_amount) : selectedCharge

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setCode = (e) => { setForm((f) => ({ ...f, code: e.target.value })); setCouponResult(null) }

  const handleSubmit = (e) => {
    e.preventDefault()
    setError(null)
    if (!selectedPlan) { setError('Selecione um plano.'); return }
    if (form.company_name.trim().length < 2) { setError('Informe o nome da empresa.'); return }
    if (form.admin_name.trim().length < 2) { setError('Informe o seu nome.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.admin_email)) { setError('Informe um e-mail válido.'); return }
    if (form.admin_password.length < 6) { setError('A senha deve ter ao menos 6 caracteres.'); return }
    signup.mutate({
      plan_id: selectedPlan.id,
      period,
      company_name: form.company_name.trim(),
      admin_name: form.admin_name.trim(),
      admin_email: form.admin_email.trim(),
      admin_password: form.admin_password,
      document: form.document.trim() || null,
      phone: form.phone.trim() || null,
      code: form.code.trim() || null,
      partner_id: partnerId || null,
    })
  }

  // Tela de sucesso — mostra o PIX para pagamento.
  if (signup.isSuccess) {
    const data = signup.data
    const pix = data?.pix
    // Cupom cobriu 100% → acesso já liberado, sem PIX/QR Code.
    const activated = data?.status === 'active'
    return (
      <Container maxWidth="sm" sx={{ py: { xs: 5, md: 8 } }}>
        <Card sx={{ p: { xs: 3, md: 4 }, textAlign: 'center' }}>
          <CheckCircleOutlineIcon color="success" sx={{ fontSize: 56 }} />
          <Typography variant="h5" sx={{ fontWeight: 800, mt: 1 }}>
            {activated ? 'Tudo pronto!' : 'Cadastro criado!'}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Plano <strong>{data?.plan}</strong> · {data?.period === 'annual' ? 'anual' : 'mensal'} · <strong>{BRL(data?.amount)}</strong>
          </Typography>
          {data?.discount > 0 && (
            <Typography variant="body2" sx={{ color: 'success.main', fontWeight: 600 }}>
              Cupom {data?.coupon?.code} aplicado: −{BRL(data.discount)} (de {BRL(data.originalAmount)})
            </Typography>
          )}

          {activated ? (
            <Alert severity="success" sx={{ mt: 3, textAlign: 'left' }}>
              Seu cupom cobriu <strong>100%</strong> da primeira cobrança — não há nada a pagar agora.
              O acesso já está <strong>liberado</strong>: é só entrar com o seu e-mail e senha.
            </Alert>
          ) : pix && (pix.qrCodeImage || pix.copyPaste) ? (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Pague com PIX para liberar o acesso</Typography>
              {pix.qrCodeImage && (
                <Box sx={{ my: 2 }}>
                  <img src={qrSrc(pix.qrCodeImage)} alt="QR Code PIX" style={{ width: 240, maxWidth: '100%', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }} />
                </Box>
              )}
              {pix.copyPaste && (
                <Stack spacing={1} sx={{ mt: 1 }}>
                  <TextField
                    value={pix.copyPaste}
                    fullWidth
                    size="small"
                    InputProps={{ readOnly: true }}
                    onFocus={(e) => e.target.select()}
                  />
                  <Button
                    variant="outlined"
                    startIcon={<ContentCopyIcon />}
                    onClick={() => navigator?.clipboard?.writeText(pix.copyPaste).catch(() => {})}
                  >
                    Copiar código PIX
                  </Button>
                </Stack>
              )}
              <Alert severity="info" sx={{ mt: 2, textAlign: 'left' }}>
                Após o pagamento, a compensação do PIX leva alguns instantes. Seu acesso é liberado <strong>automaticamente</strong> — depois é só entrar.
              </Alert>
            </Box>
          ) : (
            <Alert severity="warning" sx={{ mt: 3, textAlign: 'left' }}>
              Não foi possível gerar a cobrança PIX agora. Entre em contato com o suporte para concluir o pagamento e liberar seu acesso.
            </Alert>
          )}

          <Button variant="contained" sx={{ mt: 3 }} onClick={() => navigate('/login')}>
            {activated ? 'Entrar' : 'Já paguei — entrar'}
          </Button>
        </Card>
      </Container>
    )
  }

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Stack spacing={1} sx={{ mb: 3, textAlign: 'center' }}>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>Assine o GERO</Typography>
        <Typography color="text.secondary">Escolha o plano ideal e comece a automatizar suas cobranças hoje.</Typography>
      </Stack>

      <Stack alignItems="center" sx={{ mb: 3 }}>
        <ToggleButtonGroup
          exclusive
          value={period}
          onChange={(_, v) => v && setPeriod(v)}
          size="small"
          color="primary"
        >
          <ToggleButton value="monthly" sx={{ px: 3, fontWeight: 700 }}>Mensal</ToggleButton>
          <ToggleButton value="annual" sx={{ px: 3, fontWeight: 700 }}>Anual</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {plansQuery.isLoading ? (
        <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress /></Stack>
      ) : plansQuery.isError ? (
        <Alert severity="error">Não foi possível carregar os planos. Recarregue a página.</Alert>
      ) : plans.length === 0 ? (
        <Alert severity="info">Nenhum plano disponível no momento.</Alert>
      ) : (
        <Grid container spacing={2}>
          {plans.map((plan) => (
            <Grid item xs={12} sm={6} md={4} key={plan.id}>
              <PlanCard plan={plan} period={period} selected={planId === plan.id} onSelect={() => setPlanId(plan.id)} />
            </Grid>
          ))}
        </Grid>
      )}

      {selectedPlan && (
        <Card sx={{ p: { xs: 2.5, md: 3 }, mt: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>Seus dados</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: couponResult?.valid ? 0.5 : 2 }}>
            Plano <strong>{selectedPlan.name}</strong> · {period === 'annual' ? 'Anual' : 'Mensal'} · <strong>{BRL(selectedMonthly)}</strong>/mês
            {period === 'annual' && <> · cobrança única de <strong>{BRL(selectedCharge)}</strong></>}
          </Typography>
          {couponResult?.valid && (
            <Typography variant="body2" sx={{ mb: 2, fontWeight: 700, color: 'success.main' }}>
              Com o cupom {couponResult.code}: você paga <strong>{BRL(chargeNow)}</strong> na 1ª cobrança
              {' '}(de {BRL(selectedCharge)}). As próximas seguem o valor normal.
            </Typography>
          )}
          <Divider sx={{ mb: 2 }} />
          {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}
          <Box component="form" onSubmit={handleSubmit}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Nome da empresa" value={form.company_name} onChange={setField('company_name')} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="CPF ou CNPJ" value={form.document} onChange={setField('document')} placeholder="Só números" />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Seu nome" value={form.admin_name} onChange={setField('admin_name')} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Telefone / WhatsApp" value={form.phone} onChange={setField('phone')} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth type="email" label="E-mail de acesso" value={form.admin_email} onChange={setField('admin_email')} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth type="password" label="Senha" value={form.admin_password} onChange={setField('admin_password')} helperText="Mínimo 6 caracteres" />
              </Grid>
              <Grid item xs={12}>
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <TextField
                    fullWidth
                    label="Código de cupom (opcional)"
                    value={form.code}
                    onChange={setCode}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleApplyCoupon() } }}
                  />
                  <Button
                    variant="outlined"
                    onClick={handleApplyCoupon}
                    disabled={validateCoupon.isPending || !form.code.trim()}
                    sx={{ height: 56, whiteSpace: 'nowrap', px: 3 }}
                  >
                    {validateCoupon.isPending ? '…' : 'Aplicar'}
                  </Button>
                </Stack>
                {couponResult && (
                  couponResult.valid ? (
                    <Typography variant="body2" sx={{ mt: 1, color: 'success.main', fontWeight: 600 }}>
                      Cupom {couponResult.code} aplicado — desconto de {BRL(couponResult.discount)} na 1ª cobrança.
                    </Typography>
                  ) : (
                    <Typography variant="body2" sx={{ mt: 1, color: 'warning.main' }}>
                      {couponResult.message || 'Cupom inválido.'}
                    </Typography>
                  )
                )}
              </Grid>
            </Grid>
            <Stack direction="row" justifyContent="flex-end" sx={{ mt: 3 }}>
              <Button type="submit" variant="contained" size="large" disabled={signup.isPending}>
                {signup.isPending ? 'Enviando…' : 'Criar conta'}
              </Button>
            </Stack>
          </Box>
        </Card>
      )}

      <Stack alignItems="center" sx={{ mt: 3 }}>
        <Typography variant="body2" color="text.secondary">
          Já tem conta?{' '}
          <Button variant="text" size="small" onClick={() => navigate('/login')}>Entrar</Button>
        </Typography>
      </Stack>
    </Container>
  )
}
