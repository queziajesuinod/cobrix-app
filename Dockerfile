############################################
# Backend — baixa repo e roda Express      #
############################################
FROM node:20 AS backend

WORKDIR /app
RUN git clone https://github.com/queziajesuinod/cobrix-app.git .

WORKDIR /app/server
RUN npm install --omit=dev

ENV NODE_ENV=production
EXPOSE 3005
CMD ["npm", "start"]

############################################
# Frontend — build Vite + Caddy            #
############################################
FROM node:20 AS frontend-build

WORKDIR /client
RUN git clone https://github.com/queziajesuinod/cobrix-app.git .

WORKDIR /client/client
RUN npm install

ARG VITE_API_URL=https://apicobrix.aleftec.com.br
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

RUN npm run preview