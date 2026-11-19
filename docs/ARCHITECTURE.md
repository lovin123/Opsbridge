# Architecture

Opsbridge is a pnpm workspace:

- `apps/web` — Next.js App Router. The browser talks only to the Next origin.
- `apps/api` — NestJS modular monolith. Global prefix `api/v1`.
- `packages/shared` — Zod inputs and shared response types.

PostgreSQL is the source of truth for accounts, organizations, memberships, invitations, sessions, and audit records. Redis is connected at boot and reported by `GET /api/v1/health`. Nexconn, Cloudinary, and Groq are not called in Phase 1. Their configuration keys exist so later phases do not reshuffle environment variables.

## Request path

The web app fetches `/api/v1/...` with `credentials: "include"`. `apps/web/src/app/api/v1/[...path]/route.ts` proxies the request to `API_INTERNAL_URL` and forwards `Set-Cookie`. That keeps `Opsbridge_session` on the web origin.

Mutating requests that send an `Origin` header must match `WEB_ORIGIN` or the API's own localhost origin. Requests without `Origin` are allowed so tests and server-side clients can call the API. Browsers send `Origin` on cross-site posts.

## Identity and tenancy

Passwords use Argon2id. A session row stores the SHA-256 hash of a random token. The raw token is an HTTP-only `SameSite=Lax` cookie. Production cookies are `Secure`.

Every user receives a deterministic Nexconn user id: `u` plus the user UUID with hyphens removed. It is letters and numbers only, within Nexconn's 64-character limit. Phase 1 stores it and does not call Nexconn.

Organization access uses the caller's active membership. `X-Opsbridge-Organization` selects among memberships and is ignored unless that user belongs to the organization. A single membership is used when the header is omitted.

Roles are `ORG_ADMIN`, `OPERATIONS_MANAGER`, `SUPERVISOR`, and `TECHNICIAN`. Only an organization admin can invite people, revoke invitations, change roles, or edit the organization profile. An organization must keep at least one admin.

## Module boundaries

Phase 1 modules in the API: `auth`, `organizations`, `users`, `audit`, plus Prisma, Redis, and health. Controllers validate with Zod and delegate to services. Later modules (`teams`, `sites`, `workforce`, `shifts`, `incidents`, `assignments`, `escalations`, `notifications`, `nexconn`, `ai`, `ai-context`, `media`) stay out until their phase.

## Data ownership for later phases

- PostgreSQL: business records and incident memory. No file bytes and no second copy of the chat log.
- Nexconn: messages, history roaming, and presence.
- Cloudinary: images, video, and documents.
- Redis and BullMQ: escalations, notifications, context jobs, and media cleanup. One job stream per incident so an older summary cannot overwrite a newer context version.
- Groq: structured reasoning only. It will not change incident status.

Chat text is untrusted content inside a prompt. It cannot override system instructions or authorization.
