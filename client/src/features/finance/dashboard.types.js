// client/src/features/finance/dashboard.types.js
//
// Contrato canônico das respostas do Dashboard Financeiro. Como o client é
// JavaScript, os tipos vivem como @typedef (JSDoc, para autocompletar/documentar)
// e os schemas zod (para validar em runtime a resposta do servidor).
//
// Convenções: Percentual é fração 0..1 (null quando o denominador é zero — a UI
// formata com Intl.NumberFormat). Dinheiro tem 2 casas. Contagem é inteiro e nunca
// é somada entre meses.
import { z } from 'zod'

const Dinheiro = z.number()
const Percentual = z.number().nullable()
const Contagem = z.number().int()
const StatusCompetencia = z.enum(['ABERTO', 'FECHADO'])
const BaseCalculo = z.enum(['REALIZADO', 'REALIZADO_E_PREVISTO'])

/** @typedef {'ABERTO'|'FECHADO'} StatusCompetencia */
/** @typedef {'REALIZADO'|'REALIZADO_E_PREVISTO'} BaseCalculo */

export const kpisSchema = z.object({
  competencia: z.string(),
  status_competencia: StatusCompetencia,
  base_calculo: BaseCalculo,
  tem_lancamento: z.boolean(),
  honorarios: Dinheiro,
  contratos_ativos: Contagem,
  honorario_medio: Dinheiro.nullable(),
  despesas_fixas: Dinheiro,
  despesas_variaveis: Dinheiro,
  total_despesas: Dinheiro,
  lucro_operacional: Dinheiro,
  margem_operacional: Percentual,
  av_despesas_fixas: Percentual,
  av_despesas_variaveis: Percentual,
  variacao_mes_anterior: z
    .object({
      honorarios: Percentual,
      total_despesas: Percentual,
      lucro_operacional: Percentual,
      margem_pontos: z.number().nullable(),
    })
    .nullable(),
})
/** @typedef {z.infer<typeof kpisSchema>} DashboardKpis */

export const despesasCategoriaSchema = z.object({
  competencia: z.string(),
  total: Dinheiro,
  itens: z.array(
    z.object({
      categoria_id: z.number().nullable(),
      categoria_nome: z.string(),
      tipo: z.enum(['FIXA', 'VARIAVEL']),
      valor: Dinheiro,
      av_sobre_receita: Percentual,
      participacao_na_despesa: Percentual,
    })
  ),
})

export const evolucaoSchema = z.object({
  ano: z.number(),
  pontos: z.array(
    z.object({
      mes: z.number().int(),
      competencia: z.string(),
      status_competencia: StatusCompetencia,
      tem_lancamento: z.boolean(),
      honorarios: Dinheiro,
      honorarios_realizado: Dinheiro,
      honorarios_previsto: Dinheiro,
      despesas_fixas: Dinheiro,
      despesas_variaveis: Dinheiro,
      total_despesas: Dinheiro,
      lucro_operacional: Dinheiro,
      margem_operacional: Percentual,
    })
  ),
})

const TrioValor = z.object({ honorarios: Dinheiro, total_despesas: Dinheiro, lucro_operacional: Dinheiro })
export const projecaoSchema = z.object({
  ano: z.number(),
  competencias_consideradas: z.array(z.string()),
  meses_base: z.number().int(),
  confiabilidade: z.enum(['BAIXA', 'MEDIA', 'ALTA']),
  realizado: TrioValor,
  media_mensal: TrioValor,
  projecao: TrioValor,
})

export const receitaTipoContratoSchema = z.object({
  competencia: z.string(),
  tipos: z.array(z.string()),
  mes: z.object({
    total: Dinheiro,
    itens: z.array(z.object({ tipo_nome: z.string(), valor: Dinheiro, participacao: Percentual })),
  }),
  anual: z.object({
    ano: z.number(),
    tipos: z.array(z.string()),
    meses: z.array(z.object({ mes: z.number().int(), competencia: z.string(), valores: z.record(Dinheiro) })),
  }),
})

export const metaSchema = z.object({
  ano: z.number(),
  meta_honorarios: Dinheiro.nullable(),
  meta_despesas: Dinheiro.nullable(),
})

export const metasDashboardSchema = z.object({
  ano: z.number(),
  definida: z.boolean(),
  meta: z.object({ honorarios: Dinheiro, despesas: Dinheiro, lucro: Dinheiro }).nullable(),
  realizado: TrioValor,
  projecao: TrioValor,
})

export const insightsSchema = z.object({
  competencia: z.string(),
  itens: z.array(z.object({
    codigo: z.string(),
    severity: z.enum(['info', 'warning', 'error', 'success']),
    titulo: z.string(),
    detalhe: z.string(),
  })),
})

export const inadimplenciaSchema = z.object({
  ano: z.number(),
  meses: z.array(
    z.object({
      mes: z.number().int(),
      competencia: z.string(),
      faturado: Dinheiro,
      recebido: Dinheiro,
      vencido: Dinheiro,
      a_vencer: Dinheiro,
      inadimplencia: Percentual, // vencido ÷ faturado do mês
    })
  ),
  aging: z.object({
    b0_30: Dinheiro,
    b31_60: Dinheiro,
    b61_90: Dinheiro,
    b90_plus: Dinheiro,
    total: Dinheiro,
    titulos: z.number().int(),
  }),
})
