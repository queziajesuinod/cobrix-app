// Base da API detectada pelo hostname — FONTE ÚNICA usada por api-client e
// auth.service. Antes a mesma lógica estava duplicada nos dois, e divergir
// causava 401 (token assinado num servidor, validado noutro).
const DOMAIN_MAP = {
  'cobrix.aleftec.com.br': 'https://apicobrix.aleftec.com.br',
  'localhost': 'http://localhost:3002',
  '127.0.0.1': 'http://localhost:3002',
}

export function getApiOrigin() {
  return DOMAIN_MAP[window.location.hostname] || window.location.origin
}

export function getApiBaseUrl() {
  return `${getApiOrigin()}/api`
}
