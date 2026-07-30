# Cobrix — Runbook operacional

Guia rápido para rodar, migrar, implantar e operar o sistema (server Express + client React/Vite).

## Stack
- **server/** — Node/Express + PostgreSQL (`pg`), crons (`node-cron`), WhatsApp (Evolution API), PIX (EFI).
- **client/** — React + Vite + MUI + TanStack Query. Build estático servido pelo próprio server em produção.

## Configuração local
1. `cp server/.env.example server/.env` e preencha (ver seção **Variáveis**).
2. `cd server && npm ci && npm run migrate && npm run dev`
3. `cd client && npm ci && npm run dev` (Vite em http://localhost:5173).

## Variáveis de ambiente (server/.env)
Obrigatórias: `DB_*`, `JWT_SECRET` (forte; o boot em produção falha se ausente ou placeholder), `CREDENTIALS_SECRET` (criptografia das credenciais de gateway).
Importantes: `EVO_API_*` (WhatsApp), `PIX_CHAVE` + `EFI_WEBHOOK_SECRET` + `APP_URL` (PIX), `ALLOWED_ORIGINS`, `CRON_*`.
Opcionais: `ALERT_WEBHOOK_URL` (alertas de cron), `ENABLE_RLS`, `DB_POOL_MAX`, `DB_POOL_CONN_TIMEOUT_MS`, `DB_SSL`.

Gerar segredos:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"  # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"     # CREDENTIALS_SECRET
node -e "console.log(require('crypto').randomUUID())"                            # EFI_WEBHOOK_SECRET
```

## Migrations
- Runner rastreável: `cd server && npm run migrate`. Aplica os `.sql` de `server/migrations/` em ordem e registra em `schema_migrations` (idempotente).
- Nova migration: crie `server/migrations/NNN_descricao.sql` (numeração crescente).
- Observação: `initDb()` (em `server/src/db/index.js`) ainda roda DDL idempotente no boot por compatibilidade. Migrations novas devem ir para `server/migrations/`.

## Testes
`cd server && npm test` (runner nativo `node --test`; cobre helpers de data e do cron).

## Deploy (Docker)
- `docker build -t cobrix:latest .` — build multi-stage a partir do contexto (Stage 1 builda o client, Stage 2 roda o server servindo o `client/dist`).
- `docker compose up -d --build` — sobe app + Traefik (TLS Let's Encrypt). As variáveis vêm de `server/.env` via `env_file` (NÃO são bakeadas na imagem).
- Rode as migrations no deploy: `docker compose exec app npm run migrate` (ou como passo do pipeline).

## Crons
Rodam no mesmo processo do server (`server/src/server.js`), protegidos por advisory lock (`utils/cron-lock.js`). Agendamento via `CRON_*` (vazio desabilita o job). Estado observável na tabela `system_cron_runs` e em `GET /api/system/health`.

## Alertas & health
- `GET /healthz` — liveness (processo de pé).
- `GET /readyz` — readiness (checa o banco; 503 se indisponível). Use no uptime monitor/orquestrador.
- Defina `ALERT_WEBHOOK_URL` para receber um POST JSON quando um cron falhar (compatível com Slack/Discord/n8n/Zapier).

## Webhook PIX (EFI)
- Requer `EFI_WEBHOOK_SECRET` configurado — **sem ele o webhook é rejeitado** (fail closed).
- Ao (re)configurar o secret, registre a URL na EFI: `POST /api/webhooks/register/:companyId`.
- O processamento confere o valor pago contra o valor esperado da cobrança antes de marcar como paga.

## Rotação de segredos
Se algum segredo vazar (ex.: valores antigos do `.env.example`): rotacione a **senha do banco**, `EVO_API_KEY` e credenciais EFI no respectivo serviço, atualize `server/.env` e reinicie. Trocar `JWT_SECRET` invalida os tokens (todos relogam).

## Row-Level Security (opcional, avançado)
RLS está **desligado por padrão** (`ENABLE_RLS=false`). O isolamento entre empresas hoje é garantido pelos filtros `WHERE company_id` na aplicação. Para habilitar RLS como defesa em profundidade:
1. Aplique as policies: `node server/scripts/20250924-rls-policies.js`.
2. Rode o app como uma role do Postgres que **não seja owner** das tabelas e habilite `FORCE ROW LEVEL SECURITY` (o owner ignora RLS).
3. Ajuste os cron jobs para setar `app.company_id` por empresa (hoje eles não setam — habilitar sem isso bloquearia as cobranças).
4. Só então defina `ENABLE_RLS=true` (monta o `dbRequestContext`, que seta `app.company_id` por request) e valide em staging.
```
