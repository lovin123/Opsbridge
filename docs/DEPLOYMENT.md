# Deployment

Dockerfiles ship for the API and web app. Compose runs **only** those two services; PostgreSQL and Redis are expected to be managed/external.

## Containers

- `apps/api/Dockerfile` builds the workspace, generates the Prisma client, compiles the API, then runs migrations and `node apps/api/dist/main.js`. Needs `ca-certificates` for TLS to managed Postgres/Redis.
- `apps/web/Dockerfile` builds Next.js. `API_INTERNAL_URL` must point at the API on the Docker network (`http://api:4000` in Compose).

## Production configuration

Provide these via `.env` / orchestrator secrets (Compose uses `env_file: .env`):

- `DATABASE_URL` (external Postgres; use SSL params as required by the provider)
- `REDIS_URL` (external Redis; use `rediss://` when TLS is required)
- `WEB_ORIGIN` (the public web origin, used for CORS and origin checks)
- `NODE_ENV=production` so the session cookie is `Secure` and password-reset links are not returned in API responses
- `SESSION_COOKIE_NAME` and `SESSION_TTL_HOURS`

Leave `NEXCONN_APP_SECRET`, `GROQ_API_KEY`, and `CLOUDINARY_API_SECRET` on the API only. `NEXT_PUBLIC_NEXCONN_APP_KEY` is the only Nexconn value the browser may need (Compose passes it as a web build arg).

Run `prisma migrate deploy` as part of API startup, which the container command already does. Seed demo accounts only in a development database.

## Health

`GET /api/v1/health` returns 200 when Postgres and Redis both respond. It returns 503 when either is down. Compose waits on that check before starting `web`. Point any orchestrator health check at the same path.

## Not in this phase

There is no production hostname, TLS terminator, or managed backup runbook yet. Add those with the deployment of Nexconn webhooks, which must be reachable at `POST /api/v1/nexconn/webhooks` and answer within Nexconn's five-second timeout.
