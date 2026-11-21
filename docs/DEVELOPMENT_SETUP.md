# Development setup

## 1. Infrastructure

Postgres and Redis are **external** (managed). Docker Compose does not run them.

Copy `.env.example` to `.env` and set:

- `DATABASE_URL` — managed Postgres (include `sslmode=require` when required)
- `REDIS_URL` — managed Redis (`rediss://` when TLS is required)

The API reads `.env` when started from `apps/api`. Prisma commands use `dotenv -e ../../.env`.

## 2. Install and migrate

```bash
pnpm install
pnpm --filter @fieldops/shared build
pnpm db:migrate
pnpm db:seed
```

`pnpm db:migrate` creates the Phase 1 tables. `pnpm db:seed` upserts ABC Facilities Management and the ten demo accounts. The demo password is `DEMO_PASSWORD` or `FieldOps-demo-2026`.

## 3. Applications

```bash
pnpm dev:api
pnpm dev:web
```

API port `4000`. Web port `3000`. Swagger is at http://localhost:4000/api/docs.

Password reset links are logged by the API and returned as `devResetUrl` when `NODE_ENV` is not `production`. Invitation create returns `acceptPath` once. The raw token is not stored; the database keeps a SHA-256 hash.

## 4. Tests

Unit tests do not need Docker:

```bash
pnpm test:unit
```

API integration tests use database `fieldops_test` on the same Postgres instance and flush its tables:

```bash
pnpm test:e2e
```

Browser smoke test, with both apps running and the demo organization seeded:

```bash
pnpm --filter @fieldops/web exec playwright install chromium
pnpm test:browser
```

## 5. Full stack in Docker

Compose runs **only** `api` and `web`. Postgres and Redis stay external.

```bash
# 1) Env (managed DB/Redis + secrets)
cp .env.example .env
# Set DATABASE_URL, REDIS_URL, WEB_ORIGIN=http://localhost:3000, and API secrets

# 2) Build & start
docker compose up --build

# 3) Open
# Web  http://localhost:3000
# API  http://localhost:4000/api/v1
# Docs http://localhost:4000/api/docs
```

What each container does:

| Service | Build | Start |
| --- | --- | --- |
| `api` | install → build `@fieldops/shared` → `prisma generate` → Nest build | Nest `start:prod` (no migrate — DB schema is managed separately) |
| `web` | install → build shared → `next build` (needs `API_INTERNAL_URL` / `NEXT_PUBLIC_*` build args) | `next start` on `:3000`, proxies `/api/v1` to `http://api:4000` |

Secrets come from `.env` via `env_file` (`.env` is dockerignored and not copied into images). Compose overrides `NODE_ENV=production` and sets `API_INTERNAL_URL=http://api:4000` for the web service.
