# syntax=docker/dockerfile:1
# Build context: repository root (see docker-compose.yml).
# Runtime needs DATABASE_URL + REDIS_URL (managed Postgres/Redis — not in Compose).

FROM node:22-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@12.21.0 --activate

WORKDIR /app

# --- dependencies (full install: nest CLI + prisma live in devDependencies) ---
FROM base AS deps

# Native modules (argon2) need a toolchain during install on slim images
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

# Do not set NODE_ENV=production here — that would skip prisma / @nestjs/cli
RUN pnpm install --frozen-lockfile

# --- build ---
FROM deps AS build

COPY . .

RUN pnpm --filter @fieldops/shared build \
  && pnpm --filter @fieldops/api exec prisma generate \
  && pnpm --filter @fieldops/api build

# --- runtime ---
FROM base AS runner

ENV NODE_ENV=production
ENV API_PORT=4000

WORKDIR /app

COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/.npmrc ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/packages/shared ./packages/shared

EXPOSE 4000

# 1) apply migrations against DATABASE_URL
# 2) start Nest (cwd via pnpm filter = apps/api → dist/main.js)
CMD ["sh", "-c", "pnpm --filter @fieldops/api exec prisma migrate deploy && pnpm --filter @fieldops/api start:prod"]
