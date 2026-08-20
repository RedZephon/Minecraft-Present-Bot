FROM node:22-alpine

WORKDIR /app

# mineflayer is pinned to an upstream git commit (26.1 support landed on master
# before the 4.38.0 release), so npm needs git available at build time.
RUN apk add --no-cache git

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY server.js ./
COPY public/ ./public/

VOLUME ["/app/.minecraft", "/app/data"]

EXPOSE 3100

ENV NODE_ENV=production

CMD ["node", "server.js"]
