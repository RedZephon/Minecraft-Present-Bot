FROM node:22-alpine

WORKDIR /app

# mineflayer and minecraft-protocol are pinned to upstream git commits (26.2
# support is unreleased), so npm needs git available at build time.
RUN apk add --no-cache git

# vendor/ and scripts/ must land before `npm install` — the postinstall hook
# injects the vendored 26.2 protocol data into minecraft-data and will fail if
# they aren't in the image yet.
COPY package.json package-lock.json* ./
COPY scripts/ ./scripts/
COPY vendor/ ./vendor/
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY server.js ./
COPY public/ ./public/

VOLUME ["/app/.minecraft", "/app/data"]

EXPOSE 3100

ENV NODE_ENV=production

CMD ["node", "server.js"]
