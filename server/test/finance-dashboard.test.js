const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deriveMonth, buildKpis, computeProjecao, computeInsights } = require('../src/services/finance-dashboard');

// Linha-base de conveniência com zeros por padrão.
const row = (o = {}) => ({
  ym: '2026-07', mes: 7, closed: true,
  revManual: 0, conPaid: 0, conPrevisto: 0, contratosAtivos: 0,
  despesasFixas: 0, despesasVariaveis: 0, nRealizado: 0, nPrevisto: 0, ...o,
});

// ---------------------------------------------------------------------------
// 1. Os dez indicadores do Resumo — valores reais de julho/2026 da planilha.
// ---------------------------------------------------------------------------
test('deriva os 10 indicadores (exemplo real julho/2026)', () => {
  const d = deriveMonth(row({
    revManual: 20531.51, contratosAtivos: 35,
    despesasFixas: 7312.62, despesasVariaveis: 2243.80, nRealizado: 3,
  }));
  assert.equal(d.honorarios, 20531.51);
  assert.equal(d.contratos_ativos, 35);
  assert.equal(d.honorario_medio, 586.61);
  assert.equal(d.despesas_fixas, 7312.62);
  assert.equal(d.despesas_variaveis, 2243.80);
  assert.equal(d.total_despesas, 9556.42);
  assert.equal(d.lucro_operacional, 10975.09);
  assert.equal(d.margem_operacional, 0.5345);
  assert.equal(d.av_despesas_fixas, 0.3562);
  assert.equal(d.av_despesas_variaveis, 0.1093);
});

// ---------------------------------------------------------------------------
// 2. Margem, AV% e honorário médio com denominador zero => null (nunca 0).
// ---------------------------------------------------------------------------
test('receita zero => razões null, não zero; lucro negativo permitido', () => {
  const d = deriveMonth(row({ despesasFixas: 1000, despesasVariaveis: 500, nRealizado: 1 }));
  assert.equal(d.honorarios, 0);
  assert.equal(d.margem_operacional, null);
  assert.equal(d.av_despesas_fixas, null);
  assert.equal(d.av_despesas_variaveis, null);
  assert.equal(d.lucro_operacional, -1500); // único valor que aceita negativo
});

test('sem contratos ativos => honorário médio null', () => {
  const d = deriveMonth(row({ revManual: 5000, contratosAtivos: 0, nRealizado: 1 }));
  assert.equal(d.honorario_medio, null);
});

// ---------------------------------------------------------------------------
// 3 & 4. Média/projeção ignoram competências ABERTAS (previsto x realizado).
//        Meses futuros só com despesa NÃO contaminam a base.
// ---------------------------------------------------------------------------
test('projeção ignora meses ABERTOS e meses fechados sem lançamento', () => {
  const months = [
    row({ ym: '2026-01', closed: true, revManual: 10000, despesasFixas: 4000, nRealizado: 2 }),
    row({ ym: '2026-02', closed: true, revManual: 12000, despesasFixas: 4000, nRealizado: 2 }),
    row({ ym: '2026-03', closed: true, revManual: 0, despesasFixas: 0, nRealizado: 0 }), // fechado sem dado → fora
    row({ ym: '2026-08', closed: false, revManual: 0, despesasFixas: 4000, nRealizado: 1 }), // aberto, só despesa → fora
  ];
  const p = computeProjecao(months);
  assert.deepEqual(p.competencias_consideradas, ['2026-01', '2026-02']);
  assert.equal(p.meses_base, 2);
  // Só entram jan+fev: receita 22000, despesa 8000.
  assert.equal(p.realizado.honorarios, 22000);
  assert.equal(p.realizado.total_despesas, 8000);
});

// ---------------------------------------------------------------------------
// 5. Invariante da projeção: lucro projetado = receita proj − despesa proj.
//    (É exatamente a fórmula que a planilha viola ao projetar a média do lucro.)
// ---------------------------------------------------------------------------
test('lucro projetado = honorários projetados − despesas projetadas', () => {
  const months = [
    row({ ym: '2026-01', closed: true, revManual: 20000, despesasFixas: 6000, despesasVariaveis: 2000, nRealizado: 3 }),
    row({ ym: '2026-02', closed: true, revManual: 18000, despesasFixas: 6000, despesasVariaveis: 1000, nRealizado: 3 }),
    row({ ym: '2026-03', closed: true, revManual: 22000, despesasFixas: 6000, despesasVariaveis: 3000, nRealizado: 3 }),
  ];
  const p = computeProjecao(months);
  assert.equal(
    p.projecao.lucro_operacional,
    Math.round((p.projecao.honorarios - p.projecao.total_despesas) * 100) / 100
  );
  // As três linhas de projeção derivam da mesma base de meses.
  assert.equal(p.meses_base, 3);
  assert.equal(p.confiabilidade, 'MEDIA'); // 3..6 meses
  // Média mensal × 12 (receita 60000/3=20000 → 240000).
  assert.equal(p.projecao.honorarios, 240000);
});

// ---------------------------------------------------------------------------
// 6. Consolidado anual não soma contagem (contratos ativos) nem razões.
// ---------------------------------------------------------------------------
test('projeção não anualiza contratos ativos nem médias de razões', () => {
  const months = [
    row({ ym: '2026-01', closed: true, revManual: 10000, contratosAtivos: 30, despesasFixas: 3000, nRealizado: 2 }),
    row({ ym: '2026-02', closed: true, revManual: 10000, contratosAtivos: 35, despesasFixas: 3000, nRealizado: 2 }),
  ];
  const p = computeProjecao(months);
  // Não existe soma de contratos (30+35=65) em lugar nenhum da projeção.
  assert.equal(JSON.stringify(p).includes('65'), false);
  assert.equal('contratos_ativos' in p.projecao, false);
});

// ---------------------------------------------------------------------------
// KPIs: base de cálculo (previsto), variação e pontos percentuais.
// ---------------------------------------------------------------------------
test('base REALIZADO_E_PREVISTO soma cobranças a vencer nos honorários', () => {
  const cur = row({ ym: '2026-07', closed: false, revManual: 5000, conPaid: 5000, conPrevisto: 8000, nRealizado: 2 });
  const real = buildKpis(cur, undefined, false);
  const prev = buildKpis(cur, undefined, true);
  assert.equal(real.honorarios, 10000);
  assert.equal(real.base_calculo, 'REALIZADO');
  assert.equal(prev.honorarios, 18000);
  assert.equal(prev.base_calculo, 'REALIZADO_E_PREVISTO');
});

test('variação usa fração relativa e margem em pontos percentuais', () => {
  const cur = row({ revManual: 20000, despesasFixas: 8000, nRealizado: 2 }); // margem 0.6
  const prv = row({ revManual: 10000, despesasFixas: 5000, nRealizado: 2 }); // margem 0.5
  const k = buildKpis(cur, prv, false);
  assert.equal(k.variacao_mes_anterior.honorarios, 1); // dobrou → +100%
  assert.equal(k.variacao_mes_anterior.margem_pontos, 10); // 0.6−0.5 = +10 p.p.
});

test('sem mês anterior com lançamento => variação null', () => {
  const cur = row({ revManual: 20000, nRealizado: 1 });
  assert.equal(buildKpis(cur, undefined, false).variacao_mes_anterior, null);
  assert.equal(buildKpis(cur, row({ nRealizado: 0 }), false).variacao_mes_anterior, null);
});

test('tem_lancamento=false sinaliza estado vazio', () => {
  assert.equal(buildKpis(row({ nRealizado: 0 }), undefined, false).tem_lancamento, false);
});

// ---------------------------------------------------------------------------
// Insights automáticos.
// ---------------------------------------------------------------------------
const codigos = (ins) => ins.map((i) => i.codigo);

test('insights: nada de anormal => "tudo sob controle"', () => {
  const ins = computeInsights({ lucro_operacional: 5000, margem_operacional: 0.5, margem_anterior: 0.5, aging_total: 0, contratos_vencendo_30: 0 });
  assert.deepEqual(codigos(ins), ['ok']);
});

test('insights: prejuízo, margem em queda e carteira vencida', () => {
  const ins = computeInsights({
    lucro_operacional: -1200, margem_operacional: 0.40, margem_anterior: 0.60,
    aging_total: 3500, aging_titulos: 4, contratos_vencendo_30: 2,
  });
  const cs = codigos(ins);
  assert.ok(cs.includes('prejuizo'));
  assert.ok(cs.includes('margem_queda'));
  assert.ok(cs.includes('inadimplencia'));
  assert.ok(cs.includes('contratos_30'));
  assert.equal(ins.find((i) => i.codigo === 'prejuizo').severity, 'error');
});

test('insights: despesa fixa 20%+ acima da média dispara alerta', () => {
  const semAlerta = computeInsights({ despesas_fixas: 1100, media_despesas_fixas: 1000 });
  assert.equal(codigos(semAlerta).includes('despesa_fixa_alta'), false); // +10% não dispara
  const comAlerta = computeInsights({ despesas_fixas: 1300, media_despesas_fixas: 1000 });
  assert.ok(codigos(comAlerta).includes('despesa_fixa_alta')); // +30% dispara
});

test('insights: meta anual — atingida, em risco e no caminho', () => {
  assert.ok(codigos(computeInsights({ meta_honorarios: 100000, realizado_honorarios: 100000, projecao_honorarios: 120000 })).includes('meta_ok'));
  assert.ok(codigos(computeInsights({ meta_honorarios: 100000, realizado_honorarios: 40000, projecao_honorarios: 80000 })).includes('meta_risco'));
  assert.ok(codigos(computeInsights({ meta_honorarios: 100000, realizado_honorarios: 40000, projecao_honorarios: 95000 })).includes('meta_no_caminho'));
});
