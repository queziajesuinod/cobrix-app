const axios = require('axios')
const { query } = require('../db')

async function getCompanyEvoConfig(companyId){
  const r = await query('SELECT evo_api_url, evo_api_key FROM companies WHERE id=$1', [companyId])
  const row = r.rows[0]
  return {
    url: row?.evo_api_url || process.env.EVO_API_URL,
    key: row?.evo_api_key || process.env.EVO_API_KEY,
  }
}

async function sendWhatsapp(companyId, payload){
  const cfg = await getCompanyEvoConfig(companyId)
  if (!cfg.url || !cfg.key) throw new Error('Config EVO ausente (url/key)')
  const headers = { 'X-API-KEY': cfg.key, 'Content-Type': 'application/json' }
  const res = await axios.post(cfg.url, payload, { headers, timeout: 15000 })
  return { ok:true, provider: { status: res.status, data: res.data } }
}

module.exports = { getCompanyEvoConfig, sendWhatsapp }