-- 001_perf_indexes.sql
-- Índices para as queries quentes (filtro por empresa + faixa de data).
-- Sem eles, /overview, /kpis e a reconciliação fazem seq scan conforme os
-- dados crescem. Todos IF NOT EXISTS — seguros para rodar em bancos existentes.

CREATE INDEX IF NOT EXISTS idx_billings_company_date
  ON billings (company_id, billing_date);

CREATE INDEX IF NOT EXISTS idx_bn_contract_due
  ON billing_notifications (contract_id, due_date);

CREATE INDEX IF NOT EXISTS idx_bn_company_due
  ON billing_notifications (company_id, due_date);

CREATE INDEX IF NOT EXISTS idx_cms_company_month
  ON contract_month_status (company_id, year, month);

CREATE INDEX IF NOT EXISTS idx_bgl_company_status
  ON billing_gateway_links (company_id, status);

CREATE INDEX IF NOT EXISTS idx_notifications_company_created
  ON notifications (company_id, created_at DESC);
