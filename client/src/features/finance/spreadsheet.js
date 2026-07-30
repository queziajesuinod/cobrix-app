// Modelo (.xlsx) e leitura de planilha para importar receitas/despesas.
// O SheetJS (xlsx) é carregado sob demanda (import dinâmico) — fica num chunk
// separado e não pesa no bundle principal.

const pad = (n) => String(n).padStart(2, '0')
const stripKey = (k) => String(k).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

function pick(row, ...names) {
  const map = {}
  Object.keys(row).forEach((k) => { map[stripKey(k)] = row[k] })
  for (const n of names) {
    const v = map[stripKey(n)]
    if (v !== undefined && v !== null && String(v).trim() !== '') return v
  }
  return undefined
}
const str = (v) => (v == null ? '' : String(v).trim())
const strOrNull = (v) => (str(v) ? str(v) : null)

function toIsoDate(v) {
  if (v == null || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`
  return null
}
function toAmount(v) {
  if (typeof v === 'number') return v
  let s = String(v ?? '').replace(/[^\d,.-]/g, '').trim()
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.') // 1.234,56
  else if (s.includes(',')) s = s.replace(',', '.') // 1234,56
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}
function toBool(v) {
  return ['sim', 's', 'true', '1', 'x', 'yes'].includes(String(v ?? '').trim().toLowerCase())
}

const REV_HEADERS = ['Nomenclatura', 'Descrição', 'Valor', 'Data de recebimento']
const EXP_HEADERS = ['Nomenclatura', 'Descrição', 'Valor', 'Data de pagamento', 'Recorrente (sim/não)', 'Tipo (fixa/variável)']
const REV_SAMPLE = [['Consultoria avulsa', 'Serviço extra ao cliente X', '1500,00', '2026-07-10']]
const EXP_SAMPLE = [
  ['Aluguel', 'Aluguel do escritório', '2000,00', '2026-07-05', 'sim', 'fixa'],
  ['Material de escritório', 'Compra pontual', '350,50', '2026-07-12', 'não', 'variável'],
]

export async function downloadModelo(kind) {
  const XLSX = await import('xlsx')
  const headers = kind === 'expense' ? EXP_HEADERS : REV_HEADERS
  const sample = kind === 'expense' ? EXP_SAMPLE : REV_SAMPLE
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sample])
  ws['!cols'] = headers.map(() => ({ wch: 24 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Modelo')
  XLSX.writeFile(wb, kind === 'expense' ? 'modelo-despesas.xlsx' : 'modelo-receitas.xlsx')
}

export async function parseFile(kind, file) {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  return rows
    .map((r) => (kind === 'expense'
      ? {
          label: str(pick(r, 'nomenclatura', 'nome')),
          description: strOrNull(pick(r, 'descrição', 'descricao', 'descrição breve')),
          amount: toAmount(pick(r, 'valor')),
          paid_at: toIsoDate(pick(r, 'data de pagamento', 'data')),
          is_recurring: toBool(pick(r, 'recorrente', 'recorrente (sim/não)', 'recorrente (sim/nao)')),
          expense_type: str(pick(r, 'tipo', 'tipo (fixa/variável)', 'tipo (fixa/variavel)')) || 'variável',
        }
      : {
          label: str(pick(r, 'nomenclatura', 'nome')),
          description: strOrNull(pick(r, 'descrição', 'descricao')),
          amount: toAmount(pick(r, 'valor')),
          received_at: toIsoDate(pick(r, 'data de recebimento', 'data')),
        }))
    // descarta linhas totalmente vazias
    .filter((it) => it.label || Number.isFinite(it.amount) || it[kind === 'expense' ? 'paid_at' : 'received_at'])
}
