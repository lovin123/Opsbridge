# Deployment

Phase 1 ships Dockerfiles for the API and web app and a Compose file that also runs PostgreSQL 16 and Redis 7.

## Containers

- `apps/api/Dockerfile` builds the workspace, generates the Prisma client, compiles the API, then runs migrations and `node apps/api/dist/main.js`.
- `apps/web/Dockerfile` builds Next.js. `API_INTERNAL_URL` must point at the API on the Docker network (`http://api:4000` in Compose).

## Production configuration

Set these in the API environment, not in the browser bundle:

- `DATABASE_URL`
- `REDIS_URL`
- `WEB_ORIGIN` (the public web origin, used for CORS and origin checks)
- `NODE_ENV=production` so the session cookie is `Secure` and password-reset links are not returned in API responses
- `SESSION_COOKIE_NAME` and `SESSION_TTL_HOURS`

Leave `NEXCONN_APP_SECRET`, `GROQ_API_KEY`, and `CLOUDINARY_API_SECRET` on the API only. `NEXT_PUBLIC_NEXCONN_APP_KEY` is the only Nexconn value the browser will need, and it is unused until Phase 2.

Run `prisma migrate deploy` as part of API startup, which the container command already does. Seed demo accounts only in a development database.

## Health

`GET /api/v1/health` returns 200 when Postgres and Redis both respond. It returns 503 when either is down. Point the orchestrator health check at that path.

## Not in this phase

There is no production hostname, TLS terminator, or managed backup runbook yet. Add those with the deployment of Nexconn webhooks, which must be reachable at `POST /api/v1/nexconn/webhooks` and answer within Nexconn's five-second timeout.
