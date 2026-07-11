# Production image for aimtrace-api (NestJS + Prisma).
# Build: docker build -t aimtrace-api .
# Run via deploy/docker-compose.yml (preferred).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY prisma ./prisma
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5500

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
# Prod deps + prisma CLI (needed for `migrate deploy` on boot).
RUN npm ci --omit=dev \
  && npm install prisma@5.22.0 --no-save \
  && npx prisma generate

COPY --from=build /app/dist ./dist
COPY deploy/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
  && chown -R node:node /app

USER node
EXPOSE 5500
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["/entrypoint.sh"]
