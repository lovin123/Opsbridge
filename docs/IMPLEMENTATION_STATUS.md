# Implementation status

A phase is complete only after its tests pass. Live integration probes were re-run with credentials present in `.env`.

## Phase 1 — Foundation

- [x] pnpm workspace with Next.js, NestJS, and `@fieldops/shared`
- [x] PostgreSQL and Redis in Docker Compose, plus API and web Dockerfiles
- [x] Prisma schema for users, sessions, password resets, organizations, memberships, invitations, and audit logs
- [x] `nexconnUserId` stored at user creation
- [x] Argon2id passwords, HTTP-only session cookie, origin checks, auth rate limits
- [x] Organization RBAC: admin invites and role changes; last admin cannot be removed
- [x] Sign up, sign in, forgot password, reset password, onboarding, directory, settings, profile
- [x] ABC Facilities Management seed with ten demo accounts
- [x] Jest unit tests and API integration tests for session, tenant isolation, and RBAC
- [x] Playwright sign-in smoke test

## Phase 2 — Nexconn

- [x] Official SDK lifecycle, token endpoint, signed webhooks, BullMQ indexing
- [x] Profile ServiceHooks via `POST /api/v1/nexconn/profiles`
- [x] Incident channel provisioning with alphanumeric ids such as `inc2026000001`
- [x] Live token issue and channel retry verified against configured Nexconn credentials (`READY` for `INC-2026-0001`)
- [ ] Two-browser Chat UI message exchange still needs a manual browser pass

## Phase 3 — Cloudinary

- [x] Signed authenticated uploads, confirm, signed delivery, cleanup job
- [x] Live sign → upload → confirm → signed URL probe passed
- [x] Confirm tolerates Cloudinary format suffixes and resolves delivery type (`authenticated` / `upload` / `private`)

## Phase 4 — Workforce

- [x] Sites, teams, skills, availability, shifts, handover drafting/publishing
- [x] Seed data for Mumbai, Pune, Nashik, and the three maintenance teams

## Phase 5 — Incidents

- [x] Create, assign, status transitions, resolution notes, channel retry
- [x] Assignment and team membership validated against the active organization
- [x] `ASSIGNED` blocked when no assignee is set
- [x] Incident workspace with Chat UI, timeline, evidence, assistant

## Phase 6 — Groq and context

- [x] Server-side `groq-sdk` structured JSON with Zod validation
- [x] Default free-tier models `openai/gpt-oss-20b` with `openai/gpt-oss-120b` fallback
- [x] Live classification probe passed
- [x] Context refresh/read endpoints enforce incident access checks
- [x] Batch conversation summaries and failed-snapshot fail-closed behavior

## Phase 7 — Operations center

- [x] Dashboard KPIs, escalation policy UI, notifications with dedupe
- [x] `GET /notifications/unread-count` and `POST /notifications/read-all`
- [x] Sidebar unread badge; mark-read scoped to organization

## Phase 8 — Polish / audit fixes

- [x] Workflow, signature, origin, and id unit tests
- [x] Hardened Nexconn group provisioning for already-existing channels
- [x] Media upload UI, channel retry UI, technician create gating
- [x] Session sliding renewal when remaining TTL < 25%
- [x] Security response headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`)
- [x] List/detail pages: loading, error, empty, and pending-submit states
- [ ] Manual two-browser messaging E2E and Playwright against live Chat UI

## Verification

- Unit tests: 13 passed
- API e2e: 5 passed (auth/tenancy/RBAC)
- Live probes (`scripts/probe-integrations.mjs`, `scripts/probe-channel-upload.mjs`):
  - health, sign-in, Nexconn token, media sign, Groq classify, dashboard, context ACL denial
  - channel retry → `READY`, Cloudinary confirm, signed delivery URL
- Postgres host port `5433`, Redis host port `6380`

## Audit findings fixed in this pass

- Context endpoints leaked by incident id without membership/role checks
- Cloudinary signed `public_id` + `folder` double-nest risk; format-suffix mismatch on confirm
- AI provider swapped from Gemini to Groq; missing key fails closed as 503
- Nexconn HTTP 400 business errors previously aborted provisioning; already-existing groups now recover to `READY`
- Assignment/create now validate assignee and team belong to the org
- Sequence allocation moved inside the create transaction with P2002 retry
- Nexconn session destroy on sign-out; openChannel errors surfaced; group-members hook wired
- Team channel setup marks `FAILED` when Nexconn is absent; tokens issued for all members
- Team create now includes the creator as a member/owner so empty teams still provision a channel
- 18-char Nexconn nonce; Groq client reused; context JSON trimmed by array size not mid-string
- Channel retry RBAC; classify input validation aligned with incident description min length
- Profile availability loaded from API; analytics by-site / unassigned / overdue
- Communications no longer auto-opens self-DM; loading/error empty states added
- Notification mark-read requires organization scope; shift start/end and supervisor validated
- Incident detail disables actions while pending; hides `ASSIGNED` without an assignee
- Media link open failures surface inline; critical escalation UI/schema default is 5 minutes
- Assignment clear returns `ASSIGNED` → `OPEN`; technicians blocked from unassign via OPEN
- Incident assign form syncs team/assignee from server (no accidental team wipe)
- Dashboard / AI context scoped like incident list (tech + supervisor site)
- Session sliding renews cookie `maxAge`; webhook receipt rolled back if enqueue fails
- Team create validates site/members and always includes creator as channel owner
- Cloudinary `resolveDeliveryType` matches format-suffixed public ids; non-404 errors surface
- Confirm stores original filename + Cloudinary `asset_id`; `resourceType` enum-validated
- Intelligence uses ordered messages + READY snapshot/batches; freshness ignores FAILED
- Shift memberIds org-checked; directory skills/profiles filtered to current org
- Reopen clears `resolvedAt`/`closedAt`; assignment notify dedupe is stable
- Nexconn remount calls `ready()`; rejected boot promise cleaned up on unmount
- Escalation rescheduled on reopen/active status changes; context refresh job ids bucketed
- Supervisor without site profile fail-closed; media sign/URL respect incident visibility
- Channel READY only when join/membership succeeds; AI endpoints throttled
- Site timezone validated; availability+skills update is transactional
- Invitation accept/revoke use conditional updates (no race to ACCEPTED/REVOKED)
- Password reset claims token atomically; dashboard “today” uses org timezone
- Tech UI hides OPEN unassign; settings/sites/workforce invitations error states
- Escalation high/medium allow `0` (immediate) like critical
- List endpoints select safe user fields (no `passwordHash` leakage)
- AI context uses newest message windows + max(version)+1 after FAILED
- Escalation/notify dedupe includes generation; assign clear always → OPEN
- Tech status updates require assignee; supervisor create/sign/media scoped
- Handovers role-gated + site-scoped; Nexconn boot race hardened
- Communications only open READY channels; session errors show retry UI
- Communications clears selection on org switch; Nexconn profile hooks pass org header
- Incident action errors banner; RESOLVED requires notes; create requires explicit site
- Settings/policy and shifts sites/members error states; invite revoke errors surfaced

Left intentionally for later product work: production email for password reset/invites, PATCH incident metadata, invitation accept↔channel sync, Nexconn leave-on-unassign, webhook body-bound signatures (provider scheme is header-only), and a manual two-browser Chat UI pass.
