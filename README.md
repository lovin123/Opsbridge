# Opsbridge

Opsbridge is a multi-tenant workforce operations platform. Phase 1 is a working authenticated application: accounts, organizations, invitations, and role-based access. Later phases add Nexconn messaging, Cloudinary media, incidents, and Groq-backed incident memory.

PostgreSQL holds business records. Nexconn will hold chat. Cloudinary will hold media. Redis is already required for health checks; BullMQ jobs start in later phases.

## Phase 1 accounts

After `pnpm db:seed`, sign in at http://localhost:3000 with password `Opsbridge-demo-2026` (or `DEMO_PASSWORD` from `.env`):

| Role | Email |
| --- | --- |
| Organization admin | admin@abc-facilities.example |
| Operations manager | manager@abc-facilities.example |
| Supervisor | supervisor.pune@abc-facilities.example |
| Supervisor | supervisor.mumbai@abc-facilities.example |
| Technician | tech.electrical.1@abc-facilities.example |
| Technician | tech.electrical.2@abc-facilities.example |
| Technician | tech.mechanical.1@abc-facilities.example |
| Technician | tech.mechanical.2@abc-facilities.example |
| Technician | tech.network.1@abc-facilities.example |
| Technician | tech.network.2@abc-facilities.example |

The seed does not create incidents or chat messages.

## Requirements

- Node.js 22 or newer
- pnpm 12
- Docker, for PostgreSQL 16 and Redis 7

## Run locally

```bash
docker compose up -d postgres redis
cp .env.example .env
pnpm install
pnpm --filter @Opsbridge/shared build
pnpm db:migrate
pnpm db:seed
pnpm dev:api
pnpm dev:web
```

- Web: http://localhost:3000
- API: http://localhost:4000/api/v1
- OpenAPI: http://localhost:4000/api/docs

The browser calls `/api/v1` on the Next.js origin. Next.js proxies that path to the API and forwards the session cookie.

## Tests

```bash
pnpm test:unit
pnpm test:e2e
pnpm test:browser
```

`pnpm test:e2e` needs Postgres and Redis. `pnpm test:browser` needs the seeded API, the web app, and Playwright's Chromium browser.

See [docs/DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md) and [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md).
