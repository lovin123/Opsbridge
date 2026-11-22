# Opsbridge

Opsbridge is a multi-tenant workforce operations platform for field teams: organizations, sites, crews, shifts, incidents, media, and real-time chat/calls via Nexconn.

| Layer | Stack |
| --- | --- |
| Web | Next.js (`apps/web`) — App Router, proxies `/api/v1` to the API |
| API | NestJS (`apps/api`) — global prefix `api/v1`, OpenAPI at `/api/docs` |
| Shared | Zod types (`packages/shared`) |
| Data | Managed PostgreSQL (business records) + managed Redis (health / queues) |
| Chat | Nexconn Chat / ChatUI / Call |
| Media | Cloudinary (signed uploads) |
| AI | Groq (incident classify / context — fail-closed without keys) |

Repo package name is `fieldops`; product name is **Opsbridge**.

## Features

- Auth: sign up / sign in, sessions (HTTP-only cookie), password reset, org onboarding
- Tenancy & RBAC: orgs, invitations, roles (`ORG_ADMIN`, `OPERATIONS_MANAGER`, `SUPERVISOR`, `TECHNICIAN`), custom org roles
- Workforce: sites, teams, skills, availability, shifts, handovers
- Incidents: create → assign → status flow, evidence, timeline, per-incident chat channel
- Communications: Nexconn channel embed, voice notes, STT (when enabled), audio/video calls
- Operations: dashboard KPIs, notifications, escalation policy
- Integrations: Nexconn tokens/webhooks, Cloudinary media, Groq structured JSON

## Requirements

- Node.js **22+**
- pnpm **12** (`packageManager` is pinned in `package.json`)
- **Managed PostgreSQL** and **Redis** (Docker Compose does **not** run them)
- Docker (optional) — build/run API + web containers only

## Quick start (local)

```bash
cp .env.example .env
# Set at least: DATABASE_URL, REDIS_URL, WEB_ORIGIN=http://localhost:3000
# Optional: NEXCONN_*, CLOUDINARY_*, GROQ_*, SMTP_*

pnpm install
pnpm --filter @fieldops/shared build
pnpm db:migrate          # or pnpm db:deploy on an existing DB
pnpm db:seed             # demo org + accounts
pnpm dev                 # API :4000 + web :3000
# or: pnpm dev:api   /   pnpm dev:web
```

| URL | Purpose |
| --- | --- |
| http://localhost:3000 | Web app |
| http://localhost:4000/api/v1 | API |
| http://localhost:4000/api/docs | Swagger |
| http://localhost:4000/api/v1/health | Postgres + Redis health |

The browser calls `/api/v1` on the Next origin. Next proxies to `API_INTERNAL_URL` and forwards the session cookie.

### Demo accounts

After `pnpm db:seed`, sign in with password `Opsbridge-demo-2026` (or `DEMO_PASSWORD` from `.env`):

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

Seed creates the ABC Facilities org and workforce fixtures. It does not create live chat history.

## Environment

Copy `.env.example` → `.env`. Important variables:

| Variable | Where | Notes |
| --- | --- | --- |
| `DATABASE_URL` | API | Managed Postgres; use `sslmode=require` when the provider requires TLS |
| `REDIS_URL` | API | Managed Redis; use `rediss://` for TLS |
| `WEB_ORIGIN` | API | CORS / origin checks (e.g. `http://localhost:3000`) |
| `API_INTERNAL_URL` | Web | Local: `http://localhost:4000`; Compose: `http://api:4000` |
| `SESSION_COOKIE_NAME` / `SESSION_TTL_HOURS` | API | Cookie session |
| `DEMO_PASSWORD` | API | Seed / demo sign-in password |
| `NEXCONN_APP_KEY` / `NEXCONN_APP_SECRET` / `NEXCONN_AREA_CODE` | API | Chat — secrets stay on the API |
| `NEXT_PUBLIC_NEXCONN_APP_KEY` | Web (build) | Optional public app key for ChatUI |
| `CLOUDINARY_*` | API | Signed media uploads |
| `GROQ_API_KEY` / `GROQ_MODEL` | API | AI features fail closed if unset |
| `SMTP_*` / `MAIL_FROM` | API | Optional email; empty `SMTP_HOST` logs mail in dev |

Do not commit `.env`. Do not put API secrets in the web image.

## Docker

Compose runs **only** `api` and `web`. They use your managed `DATABASE_URL` / `REDIS_URL` from `.env`.

```bash
# .env must already point at managed Postgres + Redis
docker compose up --build
```

| Service | Start behavior |
| --- | --- |
| `api` | `node apps/api/dist/main.js` — **no** Prisma migrate on boot (schema is managed separately) |
| `web` | `next start` on `:3000`, proxies `/api/v1` → `http://api:4000` |

Apply schema changes out of band when needed:

```bash
pnpm db:migrate    # local / empty DB
pnpm db:deploy     # apply pending migrations to an existing DB
```

Details: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md).

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Shared build + API and web in parallel |
| `pnpm build` | Build shared, API, and web |
| `pnpm db:generate` / `db:migrate` / `db:deploy` / `db:seed` | Prisma |
| `pnpm test:unit` | API unit tests |
| `pnpm test:e2e` | API integration tests (needs Postgres + Redis) |
| `pnpm test:browser` | Playwright smoke (apps running + seed) |
| `pnpm lint` | Lint workspace |

```bash
pnpm test:unit
pnpm test:e2e
pnpm --filter @fieldops/web exec playwright install chromium
pnpm test:browser
```

## Repository layout

```
apps/api          NestJS API + Prisma
apps/web          Next.js UI + Nexconn ChatUI
packages/shared   Shared Zod / types
docs/             Architecture, setup, integrations
docker-compose.yml   api + web only
```

## Documentation

| Doc | Topic |
| --- | --- |
| [docs/DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md) | Local + Docker setup |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Containers, env, health |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Request path, tenancy, modules |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | API surface |
| [docs/NEXCONN_INTEGRATION.md](docs/NEXCONN_INTEGRATION.md) | Chat / Call / STT |
| [docs/CLOUDINARY_INTEGRATION.md](docs/CLOUDINARY_INTEGRATION.md) | Media |
| [docs/GROQ_INTEGRATION.md](docs/GROQ_INTEGRATION.md) | AI |
| [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) | Phase checklist |

## License

UNLICENSED — private project.
