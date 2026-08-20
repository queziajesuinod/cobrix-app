// server/src/services/coupons.js
// Cupons de desconto da assinatura SaaS. Aplicados na 1ª cobrança do signup —
// o contrato guarda o preço cheio (renovações não são descontadas).
const { query } = require('../db');
const { ensureDateOnly, formatISODate } = require('../utils/date-only');

const SCHEMA = process.env.DB_SCHEMA || 'public';

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Mensagens amigáveis por motivo de recusa (exibidas no cadastro).
const REASONS = {
  'sem-codigo': 'Informe um cupom.',
  'nao-encontrado': 'Cupom não encontrado.',
  inativo: 'Cupom indisponível.',
  'nao-iniciado': 'Este cupom ainda não está válido.',
  expirado: 'Cupom expirado.',
  'plano-nao-elegivel': 'Este cupom não vale para o plano escolhido.',
  'periodo-nao-elegivel': 'Este cupom não vale para o período escolhido.',
  'valor-minimo': 'O valor não atinge o mínimo deste cupom.',
  'limite-atingido': 'Este cupom esgotou o limite de usos.',
  'parceiro-nao-elegivel': 'Este cupom não vale para este cadastro.',
};

function fail(reason) {
  return { valid: false, reason, message: REASONS[reason] || 'Cupom inválido.' };
}

// Calcula o desconto de um cupom já carregado sobre um valor.
function computeDiscount(coupon, amount) {
  const base = Number(amount) || 0;
  let discount = 0;
  if (coupon.discount_type === 'fixed') {
    discount = Math.min(Number(coupon.discount_value) || 0, base);
  } else {
    // percent
    discount = round2((base * (Number(coupon.discount_value) || 0)) / 100);
  }
  discount = Math.max(0, round2(discount));
  const finalAmount = Math.max(0, round2(base - discount));
  return { discount, finalAmount };
}

// Valida o cupom para um plano/período/valor. Não altera nada no banco.
// Retorna { valid, reason, message } quando inválido, ou
// { valid:true, coupon, discount, finalAmount, originalAmount } quando ok.
async function validateCoupon(rawCode, { planId, period = 'monthly', amount, partnerId = null } = {}) {
  const code = normalizeCode(rawCode);
  if (!code) return fail('sem-codigo');

  const r = await query(
    `SELECT * FROM ${SCHEMA}.coupons WHERE UPPER(code) = $1 LIMIT 1`,
    [code]
  );
  const coupon = r.rows[0];
  if (!coupon) return fail('nao-encontrado');
  if (!coupon.active) return fail('inativo');

  // Escopo por dono: cupom de PARCEIRO só vale no signup pelo link dele; cupom da
  // PLATAFORMA (partner_id NULL) só vale em signup DIRETO (sem parceiro). Assim a
  // Padrão não força desconto que o parceiro absorveria, e vice-versa.
  const couponPartner = coupon.partner_id == null ? null : Number(coupon.partner_id);
  const signupPartner = partnerId == null ? null : Number(partnerId);
  if (couponPartner !== signupPartner) return fail('parceiro-nao-elegivel');

  const today = ensureDateOnly(new Date());
  const starts = ensureDateOnly(coupon.starts_at);
  const expires = ensureDateOnly(coupon.expires_at);
  if (starts && today < starts) return fail('nao-iniciado');
  if (expires && today > expires) return fail('expirado');

  if (coupon.max_redemptions != null && Number(coupon.redeemed_count) >= Number(coupon.max_redemptions)) {
    return fail('limite-atingido');
  }

  if (Array.isArray(coupon.plan_ids) && coupon.plan_ids.length > 0) {
    if (!planId || !coupon.plan_ids.map(Number).includes(Number(planId))) {
      return fail('plano-nao-elegivel');
    }
  }

  const per = period === 'annual' ? 'annual' : 'monthly';
  if (coupon.applies_to_period && coupon.applies_to_period !== 'any' && coupon.applies_to_period !== per) {
    return fail('periodo-nao-elegivel');
  }

  const base = Number(amount) || 0;
  if (coupon.min_amount != null && base < Number(coupon.min_amount)) {
    return fail('valor-minimo');
  }

  const { discount, finalAmount } = computeDiscount(coupon, base);
  return {
    valid: true,
    reason: null,
    coupon,
    originalAmount: round2(base),
    discount,
    finalAmount,
  };
}

// Registra o uso do cupom DENTRO de uma transação (recebe o client). Incrementa
// redeemed_count de forma atômica respeitando o limite (evita corrida). Se o
// limite estourou entre a validação e o resgate, retorna { redeemed:false }.
async function redeemCoupon(client, {
  couponId,
  subscriptionId = null,
  companyId = null,
  planId = null,
  period = null,
  originalAmount = null,
  discountAmount = null,
  finalAmount = null,
}) {
  if (!couponId) return { redeemed: false, reason: 'sem-cupom' };
  const upd = await client.query(
    `UPDATE ${SCHEMA}.coupons
        SET redeemed_count = redeemed_count + 1, updated_at = now()
      WHERE id = $1
        AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)
      RETURNING id`,
    [couponId]
  );
  if (!upd.rowCount) return { redeemed: false, reason: 'limite-atingido' };

  await client.query(
    `INSERT INTO ${SCHEMA}.coupon_redemptions
       (coupon_id, subscription_id, company_id, plan_id, period, original_amount, discount_amount, final_amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [couponId, subscriptionId, companyId, planId, period, originalAmount, discountAmount, finalAmount]
  );
  return { redeemed: true };
}

module.exports = {
  normalizeCode,
  computeDiscount,
  validateCoupon,
  redeemCoupon,
  formatISODate,
};
