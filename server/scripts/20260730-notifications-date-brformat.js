// server/scripts/20260730-notifications-date-brformat.js
// Reformata datas AAAA-MM-DD já gravadas no corpo das notificações in-app
// para o formato brasileiro DD/MM/AAAA.
require('dotenv').config()
const { Pool } = require('pg')

const schema = process.env.DB_SCHEMA || 'public'
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

async function main() {
  const client = await pool.connect()
  try {
    await client.query(`SET search_path TO ${schema}, public`)
    const r = await client.query(`
      UPDATE notifications
         SET body = regexp_replace(body, '(\\d{4})-(\\d{2})-(\\d{2})', '\\3/\\2/\\1', 'g')
       WHERE body ~ '\\d{4}-\\d{2}-\\d{2}'
    `)
    console.log(`✅ ${r.rowCount} notificação(ões) reformatada(s) no schema ${schema}`)
  } catch (e) {
    console.error('❌ Falha:', e.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
