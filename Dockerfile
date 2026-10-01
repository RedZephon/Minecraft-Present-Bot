FROM node:22-alpine

WORKDIR /app

# mineflayer and minecraft-protocol are pinned to upstream git commits (26.2
# support is unreleased), so npm needs git available at build time.
RUN apk add --no-cache git

# vendor/ and scripts/ must land before `npm ci` — the postinstall hook
# injects the vendored protocol data and backports into the dependencies.
COPY package.json package-lock.json ./
COPY scripts/ ./scripts/
COPY vendor/ ./vendor/
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY lib/ ./lib/
COPY views/ ./views/
COPY public/ ./public/

VOLUME ["/app/.minecraft", "/app/data"]

EXPOSE 3100

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:${WEB_PORT:-3100}/healthz || exit 1

CMD ["node", "server.js"]
