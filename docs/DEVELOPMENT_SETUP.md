# Development setup

## 1. Infrastructure

From the repository root:

```bash
docker compose up -d postgres redis
```

Postgres is published on `localhost:5433` and Redis on `localhost:6380` so they do not collide with other local services. The database is `fieldops`, user `fieldops`, password `fieldops`.

Copy `.env.example` to `.env`. The API reads that file when started from `apps/api`. Prisma commands use `dotenv -e ../../.env`.

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

```bash
docker compose up --build
```

The API container runs `prisma migrate deploy` before listening. Set Nexconn, Groq, and Cloudinary secrets in the compose environment when those phases are implemented. Do not put those secrets in the web image.
