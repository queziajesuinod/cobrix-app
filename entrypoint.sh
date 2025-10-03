#!/bin/sh
set -e

if [ ! -d "/app/.git" ]; then
  echo "📥 Clonando repositório..."
  git clone https://github.com/queziajesuinod/cobrix-app.git /app
else
  echo "📢 Atualizando repositório..."
  cd /app && git pull origin main
fi

echo "📦 Instalando dependências do client..."
cd /app/client && npm install && npm run build

echo "📦 Instalando dependências do server..."
cd /app/server && npm install

echo "📂 Copiando build do client..."
mkdir -p /app/server/public && cp -r /app/client/dist/* /app/server/public/

echo "🚀 Subindo servidor Node..."
cd /app/server && npm start
