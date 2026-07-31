// server/src/services/finance-dashboard.js
//
// Lógica PURA do Dashboard Financeiro (sem acesso a banco). Recebe os valores-base
// mensais já agregados em SQL e deriva os indicadores, garantindo as invariantes
// que a planilha de origem viola:
//   - razões (margem, AV%, honorário médio) com denominador zero => null (nunca 0);
//   - contagem (contratos ativos) nunca é somada entre meses;
//   - lucro projetado = receita projetada − despesa projetada (nunca média do lucro);
//   - média/projeção consideram apenas competências FECHADAS com lançamento realizado.
//
// Uma "linha-base" (row) tem os campos: ym, mes, closed, revManual, conPaid,
// conPrevisto, contratosAtivos, despesasFixas, despesasVariaveis, nRealizado, nPrevisto.

// ROUND meia-para-cima (half-up), simétrico para negativos — equivalente ao ROUND(x,2)
// do Postgres. O epsilon evita erro de ponto flutuante em somas como 0.145.
const r2 = (x) => (x == null || Number.isNaN(Number(x)) ? null : Math.sign(x) * Math.round(Math.abs(Number(x)) * 100 + 1e-6) / 100);
const r4 = (x) => (x == null || Number.isNaN(Number(x)) ? null : Math.sign(x) * Math.round(Math.abs(Number(x)) * 1e4 + 1e-6) / 1e4);

const num = (x) => Number(x || 0);

// Deriva os indicadores de UM mês a partir da linha-base.
// includePrevisto = base de cálculo REALIZADO_E_PREVISTO (soma cobranças a vencer).
function deriveMonth(row, includePrevisto = false) {
  const honorarios = r2(num(row.revManual) + num(row.conPaid) + (includePrevisto ? num(row.conPrevisto) : 0));
  const despesas_fixas = r2(num(row.despesasFixas));
  const despesas_variaveis = r2(num(row.despesasVariaveis));
  const total_despesas = r2(despesas_fixas + despesas_variaveis);
  const lucro_operacional = r2(honorarios - total_despesas);
  const contratos_ativos = num(row.contratosAtivos);
  const tem_realizado = num(row.nRealizado) > 0;
  const tem_lancamento = tem_realizado || (includePrevisto && num(row.conPrevisto) > 0);
  // Denominador zero => null, jamais 0 (margem indefinida ≠ margem zero).
  const ratio = (a, den) => (den ? r4(a / den) : null);
  return {
    honorarios,
    contratos_ativos,
    honorario_medio: contratos_ativos ? r2(honorarios / contratos_ativos) : null,
    despesas_fixas,
    despesas_variaveis,
    total_despesas,
    lucro_operacional,
    margem_operacional: ratio(lucro_operacional, honorarios),
    av_despesas_fixas: ratio(despesas_fixas, honorarios),
    av_despesas_variaveis: ratio(despesas_variaveis, honorarios),
    tem_lancamento,
    tem_realizado,
    closed: Boolean(row.closed),
  };
}

// Variação de um mês em relação ao anterior. Recebe os dois meses JÁ derivados.
// Valores como variação RELATIVA (fração); margem como diferença em PONTOS percentuais.
function computeVariacao(cur, prev) {
  const rel = (c, p) => (p ? r4((c - p) / p) : null);
  return {
    honorarios: rel(cur.honorarios, prev.honorarios),
    total_despesas: rel(cur.total_despesas, prev.total_despesas),
    lucro_operacional: rel(cur.lucro_operacional, prev.lucro_operacional),
    margem_pontos: (cur.margem_operacional == null || prev.margem_operacional == null)
      ? null
      : r2((cur.margem_operacional - prev.margem_operacional) * 100),
  };
}

// Monta o objeto de KPIs do mês (sem os campos de identificação de competência,
// que a rota adiciona). curRow/prevRow são linhas-base; prevRow pode ser undefined.
function buildKpis(curRow, prevRow, includePrevisto) {
  const cur = deriveMonth(curRow, includePrevisto);
  let variacao_mes_anterior = null;
  const prevTem = prevRow && (num(prevRow.nRealizado) > 0 || (includePrevisto && num(prevRow.conPrevisto) > 0));
  if (prevTem) variacao_mes_anterior = computeVariacao(cur, deriveMonth(prevRow, includePrevisto));
  return {
    status_competencia: cur.closed ? 'FECHADO' : 'ABERTO',
    base_calculo: includePrevisto ? 'REALIZADO_E_PREVISTO' : 'REALIZADO',
    tem_lancamento: cur.tem_lancamento,
    honorarios: cur.honorarios,
    contratos_ativos: cur.contratos_ativos,
    honorario_medio: cur.honorario_medio,
    despesas_fixas: cur.despesas_fixas,
    despesas_variaveis: cur.despesas_variaveis,
    total_despesas: cur.total_despesas,
    lucro_operacional: cur.lucro_operacional,
    margem_operacional: cur.margem_operacional,
    av_despesas_fixas: cur.av_despesas_fixas,
    av_despesas_variaveis: cur.av_despesas_variaveis,
    variacao_mes_anterior,
  };
}

// Um ponto da série de evolução anual.
function evolucaoPonto(row, includePrevisto) {
  const d = deriveMonth(row, includePrevisto);
  return {
    mes: num(row.mes),
    competencia: row.ym,
    status_competencia: d.closed ? 'FECHADO' : 'ABERTO',
    tem_lancamento: d.tem_lancamento,
    honorarios: d.honorarios,
    honorarios_realizado: r2(num(row.revManual) + num(row.conPaid)),
    honorarios_previsto: r2(num(row.conPrevisto)),
    despesas_fixas: d.despesas_fixas,
    despesas_variaveis: d.despesas_variaveis,
    total_despesas: d.total_despesas,
    lucro_operacional: d.lucro_operacional,
    margem_operacional: d.margem_operacional,
  };
}

// Projeção anual a partir SOMENTE das competências FECHADAS com lançamento realizado.
// Invariante testável: projecao.lucro === projecao.honorarios − projecao.total_despesas.
function computeProjecao(months) {
  const considered = months.filter((m) => m.closed && num(m.nRealizado) > 0);
  const meses_base = considered.length;
  const sum = (fn) => considered.reduce((a, m) => a + fn(m), 0);

  const honR = r2(sum((m) => num(m.revManual) + num(m.conPaid)));
  const despR = r2(sum((m) => num(m.despesasFixas) + num(m.despesasVariaveis)));
  const lucroR = r2(honR - despR);

  const mHon = meses_base ? r2(honR / meses_base) : 0;
  const mDesp = meses_base ? r2(despR / meses_base) : 0;
  const mLucro = r2(mHon - mDesp);

  const pHon = r2(mHon * 12);
  const pDesp = r2(mDesp * 12);
  const pLucro = r2(pHon - pDesp); // lucro projetado = receita proj − despesa proj

  const confiabilidade = meses_base < 3 ? 'BAIXA' : meses_base <= 6 ? 'MEDIA' : 'ALTA';

  return {
    competencias_consideradas: considered.map((m) => m.ym),
    meses_base,
    confiabilidade,
    realizado: { honorarios: honR, total_despesas: despR, lucro_operacional: lucroR },
    media_mensal: { honorarios: mHon, total_despesas: mDesp, lucro_operacional: mLucro },
    projecao: { honorarios: pHon, total_despesas: pDesp, lucro_operacional: pLucro },
  };
}

// ---------------------------------------------------------------------------
// Insights automáticos: regras que transformam os agregados em alertas acionáveis.
// Função pura (recebe o contexto já apurado) para ser testável.
// ---------------------------------------------------------------------------
const _brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const money = (v) => _brl.format(Number(v || 0))
const pts = (v) => `${v > 0 ? '+' : ''}${(Math.round(v * 10) / 10).toLocaleString('pt-BR')} p.p.`
const pctInt = (v) => `${Math.round(v * 100)}%`

function computeInsights(ctx = {}) {
  const out = []
  const c = ctx

  if (c.lucro_operacional != null && c.lucro_operacional < 0) {
    out.push({ codigo: 'prejuizo', severity: 'error', titulo: 'Prejuízo no mês', detalhe: `Lucro operacional de ${money(c.lucro_operacional)}.` })
  }

  if (c.margem_operacional != null && c.margem_anterior != null) {
    const dp = c.margem_operacional - c.margem_anterior
    if (dp <= -0.05) out.push({ codigo: 'margem_queda', severity: 'warning', titulo: 'Margem em queda', detalhe: `Margem caiu ${pts(dp * 100)} vs. mês anterior.` })
    else if (dp >= 0.05) out.push({ codigo: 'margem_alta', severity: 'success', titulo: 'Margem em alta', detalhe: `Margem subiu ${pts(dp * 100)} vs. mês anterior.` })
  }

  if (c.media_despesas_fixas && c.despesas_fixas > c.media_despesas_fixas * 1.2) {
    const excesso = c.despesas_fixas / c.media_despesas_fixas - 1
    out.push({ codigo: 'despesa_fixa_alta', severity: 'warning', titulo: 'Despesas fixas acima do normal', detalhe: `Despesas fixas ${pctInt(excesso)} acima da média dos meses fechados.` })
  }

  if (c.aging_total && c.aging_total > 0) {
    out.push({ codigo: 'inadimplencia', severity: 'warning', titulo: 'Carteira vencida', detalhe: `${money(c.aging_total)} vencidos em ${c.aging_titulos} ${c.aging_titulos === 1 ? 'título' : 'títulos'}.` })
  }

  if (c.contratos_vencendo_30 > 0) {
    out.push({ codigo: 'contratos_30', severity: 'warning', titulo: 'Contratos vencendo', detalhe: `${c.contratos_vencendo_30} contrato(s) vencem nos próximos 30 dias.` })
  } else if (c.contratos_vencendo_60 > 0) {
    out.push({ codigo: 'contratos_60', severity: 'info', titulo: 'Contratos a renovar', detalhe: `${c.contratos_vencendo_60} contrato(s) vencem nos próximos 60 dias.` })
  }

  if (c.meta_honorarios && c.meta_honorarios > 0) {
    const proj = c.projecao_honorarios
    if (c.realizado_honorarios >= c.meta_honorarios) {
      out.push({ codigo: 'meta_ok', severity: 'success', titulo: 'Meta anual atingida', detalhe: `Receita realizada já superou a meta de ${money(c.meta_honorarios)}.` })
    } else if (proj != null && proj < c.meta_honorarios * 0.9) {
      out.push({ codigo: 'meta_risco', severity: 'warning', titulo: 'Projeção abaixo da meta', detalhe: `Projeção de ${money(proj)} vs. meta de ${money(c.meta_honorarios)} (${pctInt((proj || 0) / c.meta_honorarios)}).` })
    } else {
      out.push({ codigo: 'meta_no_caminho', severity: 'info', titulo: 'No caminho da meta', detalhe: `Projeção em ${pctInt((proj || 0) / c.meta_honorarios)} da meta anual de receita.` })
    }
  }

  if (out.length === 0) {
    out.push({ codigo: 'ok', severity: 'success', titulo: 'Tudo sob controle', detalhe: 'Nenhum alerta financeiro no período.' })
  }
  return out
}

// ---------------------------------------------------------------------------
// Score de saúde financeira (0–100): índice ponderado de 5 dimensões, cada uma
// mapeada para 0–100 por faixas (pior→melhor). Dimensões sem dado são descartadas
// e os pesos renormalizados. Função pura (testável).
// ---------------------------------------------------------------------------
// worst→best: quando worst > best, a dimensão é "invertida" (menor é melhor).
function _sub(value, worst, best) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const t = (Number(value) - worst) / (best - worst);
  return Math.max(0, Math.min(100, Math.round(t * 100)));
}

const HEALTH_DIMS = [
  { key: 'margem', label: 'Rentabilidade (margem operacional)', peso: 0.30, worst: 0, best: 0.40 },
  { key: 'inadimplencia', label: 'Inadimplência', peso: 0.25, worst: 0.40, best: 0 },
  { key: 'crescimento', label: 'Crescimento de receita', peso: 0.20, worst: -0.20, best: 0.20 },
  { key: 'concentracao', label: 'Concentração de clientes', peso: 0.15, worst: 0.60, best: 0.20 },
  { key: 'estrutura_custo', label: 'Peso do custo fixo', peso: 0.10, worst: 0.70, best: 0.30 },
];

function computeHealthScore(m = {}) {
  const fatores = [];
  let somaPeso = 0, somaPond = 0;
  for (const d of HEALTH_DIMS) {
    const subscore = _sub(m[d.key], d.worst, d.best);
    if (subscore == null) continue;
    somaPeso += d.peso;
    somaPond += subscore * d.peso;
    fatores.push({ key: d.key, label: d.label, subscore, peso: d.peso, valor: m[d.key] == null ? null : Number(m[d.key]) });
  }
  const score = somaPeso > 0 ? Math.round(somaPond / somaPeso) : null;
  const band = score == null ? 'sem_dados'
    : score < 40 ? 'critico'
    : score < 60 ? 'atencao'
    : score < 80 ? 'saudavel'
    : 'excelente';
  fatores.sort((a, b) => a.subscore - b.subscore); // pior primeiro (o que puxa o score pra baixo)
  return { score, band, fatores };
}

module.exports = { r2, r4, deriveMonth, computeVariacao, buildKpis, evolucaoPonto, computeProjecao, computeInsights, computeHealthScore };
