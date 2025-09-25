// src/services/message-templates.js
const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

function dd(n) { return String(n).padStart(2, '0'); }
function formatPtDate(d) {
  const dia = dd(d.getDate());
  const mes = meses[d.getMonth()];
  const ano = d.getFullYear();
  return `${dia}/${mes}/${ano}`; // ex: 25/setembro/2025
}

function moneyBR(v) { return `R$ ${Number(v).toFixed(2)}`; }

function msgPre({ nome, tipoContrato, mesRefDate, vencimentoDate, valor, pix, empresa='Teifelt Contabilidade' }) {
  const mesRef = meses[mesRefDate.getMonth()];
  const venc = formatPtDate(vencimentoDate);
  return (
`Olá ${nome}, tudo bem?

Gostaríamos de lembrar que o vencimento referente ao ${tipoContrato} do mês de ${mesRef} está programado para o dia ${venc}, no valor de ${moneyBR(valor)}.

Para sua comodidade, seguem os dados para o pagamento:

PIX: ${pix}

Caso precise de alguma informação adicional, não hesite em nos procurar. Estamos à disposição para ajudá-lo.

Agradecemos pela confiança em nossos serviços e seguimos à disposição para o que for necessário.

Atenciosamente,
Equipe Financeira
${empresa}`
  );
}

function msgDue({ nome, tipoContrato, mesRefDate, vencimentoDate, valor, pix, empresa='Teifelt Contabilidade' }) {
  const mesRef = meses[mesRefDate.getMonth()];
  const venc = formatPtDate(vencimentoDate);
  return (
`Olá ${nome}, tudo bem?

Lembrete: o pagamento referente ao ${tipoContrato} do mês de ${mesRef} vence HOJE (${venc}), no valor de ${moneyBR(valor)}.

PIX: ${pix}

Qualquer dúvida, fale com a gente.

Atenciosamente,
Equipe Financeira
${empresa}`
  );
}

function msgLate({ nome, tipoContrato, mesRefDate, vencimentoDate, valor, pix, empresa='Teifelt Contabilidade' }) {
  const mesRef = meses[mesRefDate.getMonth()];
  const venc = formatPtDate(vencimentoDate);
  return (
`Olá ${nome}, tudo bem?

Identificamos que o pagamento referente ao ${tipoContrato} do mês de ${mesRef} está em ATRASO desde ${venc}. Valor: ${moneyBR(valor)}.

PIX: ${pix}

Se já realizou o pagamento, por favor desconsidere esta mensagem. Caso contrário, estamos à disposição para ajudar.

Atenciosamente,
Equipe Financeira
${empresa}`
  );
}

module.exports = { msgPre, msgDue, msgLate, formatPtDate, meses };