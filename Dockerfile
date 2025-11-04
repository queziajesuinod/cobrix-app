#############################################
# Multi-stage image: builds React frontend and
# bundles it with the Express API in a single
# production container.
#############################################

# Stage 1 — install dependencies (cached)
FROM node:20 AS deps
WORKDIR /app

# Backend deps
COPY server/package.json ./server/package.json
COPY server/package-lock.json ./server/package-lock.json
RUN cd server && npm ci --omit=dev

# Frontend deps
COPY client/package.json ./client/package.json
COPY client/package-lock.json ./client/package-lock.json
RUN cd client && npm ci

# Stage 2 — build frontend assets
FROM node:20 AS build
WORKDIR /app

COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/client/node_modules ./client/node_modules

COPY server ./server
COPY client ./client

ARG VITE_API_URL=http://apicobrix.aleftec.com.br
ENV VITE_API_URL=${VITE_API_URL}
RUN cd client && npm run build

# Stage 3 — production runtime
FROM node:20
ENV NODE_ENV=production
WORKDIR /app/server

COPY --from=build /app/server/package.json ./package.json
COPY --from=build /app/server/package-lock.json ./package-lock.json
COPY --from=build /app/server/src ./src
COPY --from=build /app/server/scripts ./scripts
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/client/dist ./public
COPY --from=build /app/server/.env.example ./.env.example

EXPOSE 3002

CMD ["npm", "start"]
