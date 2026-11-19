FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@12.21.0 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY . .

ENV API_INTERNAL_URL=http://api:4000

RUN pnpm --filter @fieldops/shared build && pnpm --filter @fieldops/web build

EXPOSE 3000

CMD ["pnpm", "--filter", "@fieldops/web", "start"]
