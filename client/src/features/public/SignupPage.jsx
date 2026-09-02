import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Alert, Box, Button, Card, Chip, CircularProgress, Container, Divider, Grid,
  IconButton, InputAdornment, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { useTheme, alpha } from '@mui/material/styles'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'
import BusinessOutlinedIcon from '@mui/icons-material/BusinessOutlined'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import Visibility from '@mui/icons-material/Visibility'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import geroLogo from '@/assets/gero2.png'
import { publicService } from './public.service'

const qrSrc = (v) => !v ? null : (String(v).startsWith('data:') ? v : `data:image/png;base64,${v}`)

const BRL = (v) => v == null
  ? null
  : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const EMPTY = { company_name: '', admin_name: '', admin_email: '', admin_password: '', document: '', phone: '', code: '' }

// Fundo suave da página (degradê da cor da marca → fundo), usado no cadastro e no sucesso.
function PageBackground({ children }) {
  return (
    <Box
      sx={{
        minHeight: '100dvh',
        background: (t) => `radial-gradient(1200px 400px at 50% -80px, ${alpha(t.palette.primary.main, 0.10)}, transparent 70%), ${t.palette.background.default}`,
        py: { xs: 3, md: 6 },
      }}
    >
      {children}
    </Box>
  )
}

function Brand({ subtitle }) {
  return (
    <Stack spacing={1.25} alignItems="center" sx={{ textAlign: 'center', mb: { xs: 3, md: 4 } }}>
      <Box component="img" src={geroLogo} alt="GERO" sx={{ height: 40, objectFit: 'contain' }} />
      <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: -0.5 }}>Crie sua conta no GERO</Typography>
      {subtitle && <Typography color="text.secondary" sx={{ maxWidth: 520 }}>{subtitle}</Typography>}
      <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="center" useFlexGap sx={{ mt: 0.5 }}>
        <TrustPill icon={<QrCode2Icon sx={{ fontSize: 16 }} />} label="Pagamento por PIX" />
        <TrustPill icon={<BoltOutlinedIcon sx={{ fontSize: 16 }} />} label="Acesso liberado na hora" />
        <TrustPill icon={<LockOutlinedIcon sx={{ fontSize: 16 }} />} label="Cancele quando quiser" />
      </Stack>
    </Stack>
  )
}

function TrustPill({ icon, label }) {
  return (
    <Chip
      icon={icon}
      label={label}
      size="small"
      variant="outlined"
      sx={{ bgcolor: 'background.paper', fontWeight: 600, '& .MuiChip-icon': { color: 'primary.main' } }}
    />
  )
}

function FeatureRow({ children }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <CheckRoundedIcon sx={{ fontSize: 18, color: 'success.main' }} />
      <Typography variant="body2" color="text.secondary">{children}</Typography>
    </Stack>
  )
}

function PlanCard({ plan, period, selected, onSelect }) {
  // Tanto o campo mensal quanto o anual guardam o valor POR MÊS; no anual a
  // cobrança é única (12x esse valor, paga uma vez ao ano).
  const monthly = period === 'annual' ? plan.price_annual : plan.price_monthly
  const available = monthly != null
  const annualTotal = period === 'annual' && monthly != null ? Number(monthly) * 12 : null
  const pctOff = (plan.price_monthly != null && plan.price_annual != null && Number(plan.price_annual) < Number(plan.price_monthly))
    ? Math.round((1 - Number(plan.price_annual) / Number(plan.price_monthly)) * 100)
    : 0
  return (
    <Card
      onClick={available ? onSelect : undefined}
      role="button"
      aria-pressed={selected}
      tabIndex={available ? 0 : -1}
      onKeyDown={(e) => { if (available && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect() } }}
      sx={{
        position: 'relative', p: 3, height: '100%', display: 'flex', flexDirection: 'column', gap: 1.25,
        borderRadius: 3, cursor: available ? 'pointer' : 'not-allowed', opacity: available ? 1 : 0.55,
        border: '2px solid', borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? (t) => alpha(t.palette.primary.main, 0.04) : 'background.paper',
        boxShadow: selected ? (t) => `0 12px 32px ${alpha(t.palette.primary.main, 0.20)}` : '0 1px 2px rgba(16,24,40,0.05)',
        transition: 'border-color .18s ease, box-shadow .18s ease, transform .18s ease, background-color .18s ease',
        '&:hover': available ? { transform: 'translateY(-3px)', boxShadow: (t) => `0 12px 28px ${alpha(t.palette.primary.main, 0.16)}` } : {},
        '&:focus-visible': { outline: (t) => `3px solid ${alpha(t.palette.primary.main, 0.4)}`, outlineOffset: 2 },
      }}
    >
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
        <Typography variant="h6" sx={{ fontWeight: 800 }}>{plan.name}</Typography>
        {selected
          ? <Chip size="small" color="primary" icon={<CheckRoundedIcon />} label="Selecionado" sx={{ fontWeight: 700 }} />
          : (period === 'annual' && pctOff > 0 && <Chip size="small" color="success" variant="outlined" label={`−${pctOff}%`} sx={{ fontWeight: 700 }} />)}
      </Stack>
      {plan.description && <Typography variant="body2" color="text.secondary">{plan.description}</Typography>}

      {available ? (
        <Box sx={{ mt: 0.5 }}>
          <Stack direction="row" alignItems="baseline" spacing={0.75}>
            <Typography variant="h3" sx={{ fontWeight: 800, lineHeight: 1, letterSpacing: -1 }}>{BRL(monthly)}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>/mês</Typography>
          </Stack>
          {period === 'annual'
            ? <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.main' }}>cobrado {BRL(annualTotal)} uma vez por ano</Typography>
            : (pctOff > 0 && <Typography variant="caption" color="text.secondary">no plano anual sai {BRL(plan.price_annual)}/mês</Typography>)}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Indisponível no {period === 'annual' ? 'anual' : 'mensal'}</Typography>
      )}

      <Stack spacing={0.75} sx={{ mt: 'auto', pt: 1.5 }}>
        <FeatureRow>{plan.clients_limit == null ? 'Clientes ilimitados' : `${plan.clients_limit} clientes`}</FeatureRow>
        <FeatureRow>{plan.contracts_limit == null ? 'Contratos ilimitados' : `${plan.contracts_limit} contratos`}</FeatureRow>
        {(period === 'annual' ? plan.extra_company_price_annual : plan.extra_company_price_monthly) != null && (
          <FeatureRow>Empresas adicionais no mesmo login</FeatureRow>
        )}
      </Stack>
    </Card>
  )
}

// Linha do resumo do pedido (rótulo à esquerda, valor à direita).
function SummaryRow({ label, value, color, strong }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={2}>
      <Typography variant="body2" color={strong ? 'text.primary' : 'text.secondary'} sx={{ fontWeight: strong ? 700 : 400 }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 700, color: color || 'text.primary', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
    </Stack>
  )
}

export default function SignupPage() {
  const navigate = useNavigate()
  const theme = useTheme()
  const [searchParams] = useSearchParams()
  // Link de revenda: /signup?parceiro=<id> → preços e recebimento vão para o parceiro.
  const partnerId = searchParams.get('parceiro') || null
  const [period, setPeriod] = useState('monthly')
  const [planId, setPlanId] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [extraCompanies, setExtraCompanies] = useState([])
  const [showPass, setShowPass] = useState(false)
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

  // Empresas adicionais (mesmo login): valor por empresa e total a somar na fatura.
  const extraMonthly = selectedPlan ? (period === 'annual' ? selectedPlan.extra_company_price_annual : selectedPlan.extra_company_price_monthly) : null
  const extraRate = extraMonthly == null ? 0 : (period === 'annual' ? Number(extraMonthly) * 12 : Number(extraMonthly))
  const extraAllowed = extraRate > 0
  const validExtras = extraCompanies
    .map((c) => ({ name: String(c?.name || '').trim(), document: String(c?.document || '').trim() }))
    .filter((c) => c.name.length >= 2)
  const extrasTotal = validExtras.length * extraRate
  const chargeWithExtras = Number(chargeNow || 0) + extrasTotal
  // Valor de renovação (sem o desconto do cupom, que vale só na 1ª cobrança).
  const recurringValue = Number(selectedCharge || 0) + extrasTotal
  const periodWord = period === 'annual' ? 'por ano' : 'por mês'

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
      extra_companies: extraAllowed ? validExtras : [],
    })
  }

  // ---------- Tela de sucesso — mostra o PIX para pagamento ----------
  if (signup.isSuccess) {
    const data = signup.data
    const pix = data?.pix
    const activated = data?.status === 'active' // cupom cobriu 100% → acesso já liberado
    return (
      <PageBackground>
        <Container maxWidth="sm">
          <Card sx={{ p: { xs: 3, md: 4 }, textAlign: 'center', borderRadius: 4, border: '1px solid', borderColor: 'divider', boxShadow: '0 20px 60px rgba(16,24,40,0.10)' }}>
            <Box sx={{ width: 72, height: 72, borderRadius: '50%', mx: 'auto', display: 'grid', placeItems: 'center', bgcolor: (t) => alpha(t.palette.success.main, 0.12) }}>
              <CheckCircleOutlineIcon color="success" sx={{ fontSize: 44 }} />
            </Box>
            <Typography variant="h5" sx={{ fontWeight: 800, mt: 2 }}>
              {activated ? 'Tudo pronto!' : 'Cadastro criado!'}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Plano <strong>{data?.plan}</strong> · {data?.period === 'annual' ? 'anual' : 'mensal'} · <strong>{BRL(data?.amount)}</strong>
              {data?.extraCompanies > 0 && <> · {data.extraCompanies} empresa(s) adicional(is)</>}
            </Typography>
            {data?.discount > 0 && (
              <Typography variant="body2" sx={{ color: 'success.main', fontWeight: 600, mt: 0.5 }}>
                Cupom {data?.coupon?.code}: −{BRL(data.discount)} (de {BRL(data.originalAmount)})
              </Typography>
            )}

            {activated ? (
              <Alert severity="success" sx={{ mt: 3, textAlign: 'left', borderRadius: 2 }}>
                Seu cupom cobriu <strong>100%</strong> da primeira cobrança — não há nada a pagar agora.
                O acesso já está <strong>liberado</strong>: é só entrar com o seu e-mail e senha.
              </Alert>
            ) : pix && (pix.qrCodeImage || pix.copyPaste) ? (
              <Box sx={{ mt: 2.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Pague com PIX para liberar o acesso</Typography>
                {pix.qrCodeImage && (
                  <Box sx={{ my: 2, p: 1.5, display: 'inline-block', borderRadius: 3, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                    <img src={qrSrc(pix.qrCodeImage)} alt="QR Code para pagamento via PIX" style={{ width: 232, maxWidth: '100%', display: 'block', borderRadius: 8 }} />
                  </Box>
                )}
                {pix.copyPaste && (
                  <Stack spacing={1} sx={{ mt: 1 }}>
                    <TextField value={pix.copyPaste} fullWidth size="small" InputProps={{ readOnly: true }} onFocus={(e) => e.target.select()} />
                    <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => navigator?.clipboard?.writeText(pix.copyPaste).catch(() => {})}>
                      Copiar código PIX
                    </Button>
                  </Stack>
                )}
                <Alert severity="info" sx={{ mt: 2, textAlign: 'left', borderRadius: 2 }}>
                  A compensação do PIX leva alguns instantes. Seu acesso é liberado <strong>automaticamente</strong> — depois é só entrar.
                </Alert>
              </Box>
            ) : (
              <Alert severity="warning" sx={{ mt: 3, textAlign: 'left', borderRadius: 2 }}>
                Não foi possível gerar a cobrança PIX agora. Fale com o suporte para concluir o pagamento e liberar seu acesso.
              </Alert>
            )}

            <Button variant="contained" size="large" sx={{ mt: 3, borderRadius: 2, px: 4 }} onClick={() => navigate('/login')}>
              {activated ? 'Entrar' : 'Já paguei — entrar'}
            </Button>
          </Card>
        </Container>
      </PageBackground>
    )
  }

  // ---------- Cadastro ----------
  const hasAnnual = plans.some((p) => p.price_annual != null && p.price_monthly != null && Number(p.price_annual) < Number(p.price_monthly))
  const toggleSx = {
    bgcolor: 'background.paper', borderRadius: 999, p: 0.5, border: '1px solid', borderColor: 'divider',
    '& .MuiToggleButtonGroup-grouped': {
      border: 0, borderRadius: '999px !important', px: 3, py: 0.75, fontWeight: 700, textTransform: 'none',
      '&.Mui-selected': { bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' } },
    },
  }

  return (
    <PageBackground>
      <Container maxWidth="lg">
        <Brand subtitle="Escolha o plano ideal e comece a automatizar suas cobranças hoje. Sem fidelidade — cancele quando quiser." />

        {/* Seletor de período */}
        <Stack alignItems="center" spacing={1} sx={{ mb: 3 }}>
          <ToggleButtonGroup exclusive value={period} onChange={(_, v) => v && setPeriod(v)} size="small" sx={toggleSx}>
            <ToggleButton value="monthly">Mensal</ToggleButton>
            <ToggleButton value="annual">Anual</ToggleButton>
          </ToggleButtonGroup>
          {hasAnnual && <Chip size="small" color="success" variant="outlined" label="Economize pagando no plano anual" sx={{ fontWeight: 700 }} />}
        </Stack>

        {/* Planos */}
        {plansQuery.isLoading ? (
          <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress /></Stack>
        ) : plansQuery.isError ? (
          <Alert severity="error" sx={{ borderRadius: 2 }}>Não foi possível carregar os planos. Recarregue a página.</Alert>
        ) : plans.length === 0 ? (
          <Alert severity="info" sx={{ borderRadius: 2 }}>Nenhum plano disponível no momento.</Alert>
        ) : (
          <Grid container spacing={2.5} justifyContent="center">
            {plans.map((plan) => (
              <Grid item xs={12} sm={6} md={4} key={plan.id}>
                <PlanCard plan={plan} period={period} selected={planId === plan.id} onSelect={() => setPlanId(plan.id)} />
              </Grid>
            ))}
          </Grid>
        )}

        {/* Formulário + resumo do pedido */}
        {selectedPlan && (
          <Grid container spacing={3} sx={{ mt: 0.5 }}>
            {/* Coluna do formulário */}
            <Grid item xs={12} md={7} lg={8}>
              <Card sx={{ p: { xs: 2.5, md: 3.5 }, borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
                <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 2.5 }}>
                  <Box sx={{ width: 36, height: 36, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: (t) => alpha(t.palette.primary.main, 0.1), color: 'primary.main' }}>
                    <BusinessOutlinedIcon fontSize="small" />
                  </Box>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.2 }}>Seus dados</Typography>
                    <Typography variant="caption" color="text.secondary">Empresa principal e acesso do administrador</Typography>
                  </Box>
                </Stack>

                {error && <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError(null)}>{error}</Alert>}

                <Box component="form" id="signup-form" onSubmit={handleSubmit}>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                      <TextField fullWidth required label="Nome da empresa" value={form.company_name} onChange={setField('company_name')} autoComplete="organization" />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField fullWidth label="CPF ou CNPJ" value={form.document} onChange={setField('document')} placeholder="Só números" inputProps={{ inputMode: 'numeric' }} />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField fullWidth required label="Seu nome" value={form.admin_name} onChange={setField('admin_name')} autoComplete="name" />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField fullWidth label="Telefone / WhatsApp" value={form.phone} onChange={setField('phone')} type="tel" autoComplete="tel" inputProps={{ inputMode: 'tel' }} />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField fullWidth required type="email" label="E-mail de acesso" value={form.admin_email} onChange={setField('admin_email')} autoComplete="email" inputProps={{ inputMode: 'email' }} />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        fullWidth required type={showPass ? 'text' : 'password'} label="Senha" value={form.admin_password}
                        onChange={setField('admin_password')} helperText="Mínimo 6 caracteres" autoComplete="new-password"
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton onClick={() => setShowPass((s) => !s)} edge="end" aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'} size="small">
                                {showPass ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        }}
                      />
                    </Grid>

                    {/* Cupom */}
                    <Grid item xs={12}>
                      <Stack direction="row" spacing={1} alignItems="flex-start">
                        <TextField
                          fullWidth label="Código de cupom (opcional)" value={form.code} onChange={setCode}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleApplyCoupon() } }}
                        />
                        <Button variant="outlined" onClick={handleApplyCoupon} disabled={validateCoupon.isPending || !form.code.trim()} sx={{ height: 56, whiteSpace: 'nowrap', px: 3, borderRadius: 2 }}>
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

                  {/* Empresas adicionais */}
                  {extraAllowed && (
                    <Box sx={{ mt: 3, p: { xs: 2, sm: 2.5 }, borderRadius: 2.5, border: '1px dashed', borderColor: 'divider', bgcolor: (t) => alpha(t.palette.primary.main, 0.03) }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <BusinessOutlinedIcon fontSize="small" color="primary" />
                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Mais de uma empresa?</Typography>
                        <Chip size="small" label="opcional" variant="outlined" sx={{ height: 20 }} />
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, mb: 1.5 }}>
                        Gerencie várias empresas com este mesmo login. Cada empresa a mais custa <strong>{BRL(extraRate)}</strong>{period === 'annual' ? ' (cobrança anual)' : '/mês'} e entra na mesma fatura.
                      </Typography>
                      <Stack spacing={1.5}>
                        {extraCompanies.map((c, i) => (
                          <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                            <TextField fullWidth size="small" label={`Empresa adicional ${i + 1}`} value={c?.name || ''}
                              onChange={(e) => setExtraCompanies((arr) => arr.map((v, j) => (j === i ? { ...v, name: e.target.value } : v)))} />
                            <TextField fullWidth size="small" label="CPF ou CNPJ" placeholder="Só números" value={c?.document || ''} inputProps={{ inputMode: 'numeric' }}
                              onChange={(e) => setExtraCompanies((arr) => arr.map((v, j) => (j === i ? { ...v, document: e.target.value } : v)))} />
                            <IconButton color="error" aria-label="Remover empresa" onClick={() => setExtraCompanies((arr) => arr.filter((_, j) => j !== i))}>
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </Stack>
                        ))}
                        <Box>
                          <Button size="small" variant="outlined" startIcon={<AddIcon />} sx={{ borderRadius: 2 }} onClick={() => setExtraCompanies((arr) => [...arr, { name: '', document: '' }])}>
                            Adicionar empresa
                          </Button>
                        </Box>
                      </Stack>
                    </Box>
                  )}
                </Box>
              </Card>
            </Grid>

            {/* Coluna do resumo do pedido (fixa no desktop) */}
            <Grid item xs={12} md={5} lg={4}>
              <Card sx={{ p: { xs: 2.5, md: 3 }, borderRadius: 3, border: '1px solid', borderColor: 'divider', position: { md: 'sticky' }, top: 24, boxShadow: '0 8px 30px rgba(16,24,40,0.06)' }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                  <ReceiptLongOutlinedIcon fontSize="small" color="primary" />
                  <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Resumo do pedido</Typography>
                </Stack>

                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
                  <Box>
                    <Typography sx={{ fontWeight: 700 }}>{selectedPlan.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{period === 'annual' ? 'Plano anual' : 'Plano mensal'}</Typography>
                  </Box>
                  <Chip size="small" color="primary" variant="outlined" label={period === 'annual' ? 'Anual' : 'Mensal'} sx={{ fontWeight: 700 }} />
                </Stack>

                <Divider sx={{ my: 1.5 }} />

                <Stack spacing={1}>
                  <SummaryRow label="Plano" value={BRL(selectedCharge)} />
                  {validExtras.length > 0 && (
                    <SummaryRow label={`Empresas adicionais (${validExtras.length}×)`} value={`+ ${BRL(extrasTotal)}`} />
                  )}
                  {couponResult?.valid && Number(couponResult.discount) > 0 && (
                    <SummaryRow label={`Cupom ${couponResult.code}`} value={`− ${BRL(couponResult.discount)}`} color="success.main" />
                  )}
                </Stack>

                <Divider sx={{ my: 1.5 }} />

                <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                  <Typography sx={{ fontWeight: 800 }}>Total agora</Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800, color: 'primary.main', fontVariantNumeric: 'tabular-nums' }}>{BRL(chargeWithExtras)}</Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  {couponResult?.valid && Number(couponResult.discount) > 0
                    ? <>Depois renova por <strong>{BRL(recurringValue)}</strong> {periodWord}.</>
                    : (period === 'annual' ? <>Cobrança única, renova {periodWord}.</> : <>Renova todo mês. Cancele quando quiser.</>)}
                </Typography>

                <Button
                  type="submit" form="signup-form" fullWidth variant="contained" size="large"
                  disabled={signup.isPending} endIcon={!signup.isPending && <ArrowForwardRoundedIcon />}
                  sx={{ mt: 2.5, py: 1.35, borderRadius: 2, fontWeight: 800, fontSize: 16 }}
                >
                  {signup.isPending ? <CircularProgress size={22} color="inherit" /> : 'Criar conta e pagar'}
                </Button>

                <Stack spacing={1} sx={{ mt: 2 }}>
                  <TrustItem icon={<QrCode2Icon />} text="Pagamento seguro via PIX" />
                  <TrustItem icon={<BoltOutlinedIcon />} text="Acesso liberado automaticamente após o pagamento" />
                  <TrustItem icon={<ShieldOutlinedIcon />} text="Seus dados ficam protegidos" />
                </Stack>
              </Card>
            </Grid>
          </Grid>
        )}

        <Stack alignItems="center" sx={{ mt: 4 }}>
          <Typography variant="body2" color="text.secondary">
            Já tem conta?{' '}
            <Button variant="text" size="small" sx={{ fontWeight: 700 }} onClick={() => navigate('/login')}>Entrar</Button>
          </Typography>
        </Stack>
      </Container>
    </PageBackground>
  )
}

function TrustItem({ icon, text }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Box sx={{ color: 'success.main', display: 'grid', placeItems: 'center' }}>{React.cloneElement(icon, { sx: { fontSize: 18 } })}</Box>
      <Typography variant="caption" color="text.secondary">{text}</Typography>
    </Stack>
  )
}
