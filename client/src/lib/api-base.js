// Base da API — FONTE ÚNICA usada por api-client e auth.service. Antes a lógica
// estava duplicada nos dois, e divergir causava 401 (token assinado num
// servidor, validado noutro).
//
// Ordem de resolução da ORIGEM da API:
//   1) VITE_API_URL (definido em build time). Prioridade máxima — é o caso do
//      deploy em dois serviços: frontend em gero.app.br e API em
//      api.gero.app.br (origens separadas). Aceita valor com ou sem "/api" no
//      fim (normalizamos abaixo).
//   2) Mapa por hostname — atalho para o dev local.
//   3) Fallback: mesma origem do site (front e API no mesmo domínio).
const DOMAIN_MAP = {
  'localhost': 'http://localhost:3002',
  '127.0.0.1': 'http://localhost:3002',
}

// Remove barra final e um eventual sufixo "/api" para deixar só a ORIGEM;
// getApiBaseUrl acrescenta o "/api" uma única vez. Assim VITE_API_URL pode vir
// como "https://api.gero.app.br" ou "http://localhost:3002/api" sem duplicar.
function normalizeOrigin(url) {
  return String(url).replace(/\/+$/, '').replace(/\/api$/, '')
}

export function getApiOrigin() {
  const envUrl = import.meta.env.VITE_API_URL
  if (envUrl) return normalizeOrigin(envUrl)
  return DOMAIN_MAP[window.location.hostname] || window.location.origin
}

export function getApiBaseUrl() {
  return `${getApiOrigin()}/api`
}
