# syntax=docker/dockerfile:1
# Build context: repository root (see docker-compose.yml).
# Browser traffic → Next (:3000) → proxies /api/v1 to API_INTERNAL_URL.

FROM node:22-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@12.21.0 --activate

WORKDIR /app

# --- dependencies ---
FROM base AS deps

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

# --- build ---
FROM deps AS build

COPY . .

# Must be present before `next build` (inlined for NEXT_PUBLIC_*; server reads API_INTERNAL_URL too)
ARG API_INTERNAL_URL=http://api:4000
ARG NEXT_PUBLIC_NEXCONN_APP_KEY=
ENV API_INTERNAL_URL=$API_INTERNAL_URL
ENV NEXT_PUBLIC_NEXCONN_APP_KEY=$NEXT_PUBLIC_NEXCONN_APP_KEY
ENV NODE_ENV=production

RUN pnpm --filter @fieldops/shared build \
  && pnpm --filter @fieldops/web build

# --- runtime ---
FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

WORKDIR /app

ARG API_INTERNAL_URL=http://api:4000
ARG NEXT_PUBLIC_NEXCONN_APP_KEY=
ENV API_INTERNAL_URL=$API_INTERNAL_URL
ENV NEXT_PUBLIC_NEXCONN_APP_KEY=$NEXT_PUBLIC_NEXCONN_APP_KEY

COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/.npmrc ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web ./apps/web
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

EXPOSE 3000

CMD ["pnpm", "--filter", "@fieldops/web", "start"]
