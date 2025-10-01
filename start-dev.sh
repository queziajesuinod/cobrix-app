#!/bin/bash

echo "🚀 Iniciando Cobrix em modo desenvolvimento..."

# Função para limpar processos ao sair
cleanup() {
    echo "🛑 Parando serviços..."
    pkill -f "node.*server.js" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    exit 0
}

# Capturar Ctrl+C
trap cleanup SIGINT SIGTERM

# Verificar se as dependências estão instaladas
if [ ! -d "server/node_modules" ]; then
    echo "📦 Instalando dependências do servidor..."
    cd server && npm install && cd ..
fi

if [ ! -d "client/node_modules" ]; then
    echo "📦 Instalando dependências do cliente..."
    cd client && npm install && cd ..
fi

# Iniciar servidor em background
echo "🔧 Iniciando servidor backend..."
cd server
nohup node src/server.js > server.log 2>&1 &
SERVER_PID=$!
cd ..

# Aguardar servidor iniciar
sleep 3

# Verificar se servidor está rodando
if curl -s http://localhost:3001/api/status > /dev/null; then
    echo "✅ Servidor backend rodando na porta 3001"
else
    echo "❌ Falha ao iniciar servidor backend"
    exit 1
fi

# Iniciar cliente
echo "🎨 Iniciando cliente frontend..."
cd client
npm run dev

# Se chegou aqui, o usuário parou o cliente
cleanup
