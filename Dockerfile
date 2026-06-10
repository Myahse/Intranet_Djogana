# ── Build frontend (Vite) ──
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:ci

# ── Runtime (Express + dist) ──
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8010

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY --from=builder /app/dist ./dist

EXPOSE 8010

CMD ["node", "server/index.cjs"]
