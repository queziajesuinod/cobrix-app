# Cobrix Fullstack (Vite + Express + PostgreSQL)

## Como rodar (dev)
```bash
cp server/.env.example server/.env
# edite o .env com seu PostgreSQL. Em dev, DB_SCHEMA=dev
npm i
npm run dev
```
- Frontend: http://localhost:5173
- Backend:  http://localhost:3001

> Primeiro login (seed): **master@cobrix.app / admin123** (criado automaticamente se não houver master).

## Produção
- Ajuste `server/.env.production` (se quiser) com `DB_SCHEMA=public` e `JWT_SECRET` forte.
- Rode só a API: `npm --prefix server run start` e sirva o `client/dist` via Nginx (ou adapte o server para servir o dist).

## Multi-tenant
- Usuário **master** escolhe a empresa e o front envia `X-Company-Id` automaticamente.
- Usuário **normal** usa `company_id` do token (sem enviar header).
