# API reference

Interactive documentation is served at `/api/docs` when the API is running. Phase 1 routes are under `/api/v1`.

## Health

- `GET /health` — Postgres and Redis. No session required.

## Auth

- `POST /auth/signup` — name, email, password. Sets `fieldops_session`.
- `POST /auth/signin` — email and password. Sets the session cookie.
- `POST /auth/signout` — deletes the current session.
- `POST /auth/forgot-password` — always returns the same message. In non-production responses, `devResetUrl` is included when the account exists.
- `POST /auth/reset-password` — token and new password. Revokes existing sessions.
- `GET /auth/me` — current user and active memberships.

Credential posts are rate-limited. Passwords need at least 10 characters, one letter, and one number.

## Organizations

Authenticated. Organization routes that read or change a tenant require membership. Send `X-FieldOps-Organization` when the user belongs to more than one organization.

- `POST /organizations` — create an organization. The caller becomes `ORG_ADMIN`.
- `GET /organizations/current`
- `PATCH /organizations/current` — `ORG_ADMIN`.
- `GET /organizations/current/members` — any member.
- `PATCH /organizations/current/members/:membershipId` — `ORG_ADMIN`. Cannot remove the last admin.
- `GET /organizations/current/invitations` — `ORG_ADMIN`.
- `POST /organizations/current/invitations` — `ORG_ADMIN`. Returns `acceptPath` once.
- `POST /organizations/current/invitations/:invitationId/revoke` — `ORG_ADMIN`.

## Invitations and profile

- `POST /invitations/accept` — signed-in user whose email matches the invitation.
- `PATCH /users/me` — name, phone, and job title.

## Authorization failures

A missing or expired session is 401. A membership or role failure is 403. A foreign organization id is 403, not an empty list. Validation errors are 400 and include `errors` keyed by field.
