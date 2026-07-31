// server/src/services/risk.js
//
// Score de risco de inadimplência por cliente — modelo heurístico, transparente
// e explicável (sem ML/dependência externa). Quanto MAIOR o score, MAIOR o risco.
//
// Fatores (cada um normalizado para 0..1) e pesos:
//   - late_rate  (0.35): % dos pagamentos que foram feitos após o vencimento
//   - avg_days   (0.15): atraso médio (em dias) nos pagamentos que atrasaram
//   - open_days  (0.30): há quantos dias está aberta a cobrança vencida mais antiga
//   - open_count (0.20): quantas cobranças vencidas em aberto
//
// Faixas: baixo (0-33), medio (34-66), alto (67-100).

const WEIGHTS = { lateRate: 0.35, avgDays: 0.15, openDays: 0.30, openCount: 0.20 };
const NORM = { avgDays: 30, openDays: 60, openCount: 3 }; // valores que saturam o fator em 1

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function bandForScore(score) {
  if (score >= 67) return 'alto';
  if (score >= 34) return 'medio';
  return 'baixo';
}

// metrics: { total_billings, total_paid, paid_late, avg_days_late,
//            open_overdue_count, max_open_days, open_overdue_amount }
function computeRiskScore(metrics = {}) {
  const totalBillings = Number(metrics.total_billings || 0);
  const totalPaid = Number(metrics.total_paid || 0);
  const paidLate = Number(metrics.paid_late || 0);
  const avgDaysLate = Number(metrics.avg_days_late || 0);
  const openCount = Number(metrics.open_overdue_count || 0);
  const maxOpenDays = Number(metrics.max_open_days || 0);
  const openAmount = Number(metrics.open_overdue_amount || 0);

  // Sem nenhuma cobrança gerada → não há base para pontuar.
  if (totalBillings === 0) {
    return { score: null, band: 'sem_historico', factors: [], openAmount: 0, openCount: 0, maxOpenDays: 0 };
  }

  const lateRate = totalPaid > 0 ? paidLate / totalPaid : 0;
  const s = {
    lateRate: clamp01(lateRate),
    avgDays: clamp01(avgDaysLate / NORM.avgDays),
    openDays: clamp01(maxOpenDays / NORM.openDays),
    openCount: clamp01(openCount / NORM.openCount),
  };

  const raw =
    WEIGHTS.lateRate * s.lateRate +
    WEIGHTS.avgDays * s.avgDays +
    WEIGHTS.openDays * s.openDays +
    WEIGHTS.openCount * s.openCount;

  const score = Math.round(clamp01(raw) * 100);
  // Score 0 = risco nulo (sem atrasos e nada em aberto) → faixa própria "bom
  // pagador", distinta de "baixo" (1-33, risco pequeno mas existente).
  const band = score === 0 ? 'bom_pagador' : bandForScore(score);

  // Fatores explicáveis para exibir na UI ("por que este score?").
  const factors = [];
  if (openCount > 0) {
    factors.push({ key: 'open_count', label: `${openCount} cobrança(s) vencida(s) em aberto` });
  }
  if (maxOpenDays > 0) {
    factors.push({ key: 'open_days', label: `Vencida há ${maxOpenDays} dia(s)` });
  }
  if (totalPaid > 0 && paidLate > 0) {
    factors.push({ key: 'late_rate', label: `${Math.round(lateRate * 100)}% dos pagamentos em atraso` });
  }
  if (avgDaysLate >= 1) {
    factors.push({ key: 'avg_days', label: `Atraso médio de ${Math.round(avgDaysLate)} dia(s)` });
  }
  if (factors.length === 0) {
    factors.push({ key: 'ok', label: 'Bom histórico de pagamento' });
  }

  return { score, band, factors, openAmount, openCount, maxOpenDays };
}

module.exports = { computeRiskScore, WEIGHTS, NORM, bandForScore };
