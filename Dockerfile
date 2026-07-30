# syntax=docker/dockerfile:1
#
# Build reprodutível a partir do contexto do repositório (sem git clone).
# Imagem final: backend Express que serve a API e o SPA (client/dist) buildado.

########## Stage 1: build do frontend (Vite) ##########
FROM node:20-slim AS frontend-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
# URL da API embutida no bundle em build time.
ARG VITE_API_URL=https://apicobrix.aleftec.com.br
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

########## Stage 2: runtime do backend ##########
FROM node:20-slim AS backend
ENV NODE_ENV=production
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/ ./

# Coloca o build do frontend onde o server.js procura: /app/client/dist
# (candidateDirs em server/src/server.js resolve para ../../client/dist).
COPY --from=frontend-build /app/client/dist /app/client/dist

EXPOSE 3002
CMD ["node", "src/server.js"]
