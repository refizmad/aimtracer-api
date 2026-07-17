# Production image for aimtrace-api (NestJS + Prisma 7).
# Prisma 7 requires Node 20.19+ / 22.12+ / 24+.
# Build: docker build -t aimtrace-api .
# Run via deploy/docker-compose.yml (preferred).
# Coolify: set Build Pack = Dockerfile (not Nixpacks).

FROM node:22.16-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
# postinstall runs prisma generate; schema is not present yet in this stage.
RUN npm ci --ignore-scripts

FROM deps AS build
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
# Generate client into src/generated, then compile Nest app (includes generated TS).
RUN npx prisma generate && npm run build

FROM node:22.16-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5500

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# Prod deps include prisma CLI for migrate deploy on boot.
# Skip postinstall generate: runtime uses compiled client from dist.
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /app/dist ./dist
COPY deploy/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
  && chown -R node:node /app \
  && test -f prisma/migrations/migration_lock.toml \
  && test -d prisma/migrations/20260711000000_init

USER node
EXPOSE 5500
# Prefer readiness (DB) over bare liveness so Coolify doesn't route while Postgres is down.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health/ready" || exit 1

ENTRYPOINT ["/entrypoint.sh"]
