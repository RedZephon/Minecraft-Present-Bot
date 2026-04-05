FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY server.js ./
COPY public/ ./public/

VOLUME ["/app/.minecraft", "/app/data"]

EXPOSE 3100

ENV NODE_ENV=production

CMD ["node", "server.js"]
