# Image unique : le serveur de synchronisation, qui sert aussi l'application web.
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /srv
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY server/index.mjs ./
COPY --from=web /app/dist ./public
ENV STATIC_DIR=/srv/public DATA_FILE=/data/nautila.db PORT=8787 NODE_NO_WARNINGS=1
VOLUME /data
USER node
EXPOSE 8787
CMD ["node", "index.mjs"]
