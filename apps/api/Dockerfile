FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@12.21.0 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @fieldops/shared build \
  && pnpm --filter @fieldops/api exec prisma generate \
  && pnpm --filter @fieldops/api build

EXPOSE 4000

CMD ["sh", "-c", "pnpm --filter @fieldops/api exec prisma migrate deploy && node apps/api/dist/main.js"]
