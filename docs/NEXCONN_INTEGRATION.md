# Nexconn integration

Implemented in Phase 2. Packages: `@nexconn/engine` and `@nexconn/chat` `26.2.1`, `@nexconn/chatui` `26.2.5`, `@nexconn/call` `26.2.1`.

## Client lifecycle

`apps/web/src/components/nexconn-chat.tsx` loads only in the browser:

1. `NCCallEngine.install()` (Call SDK Chat bridge; once, before Engine init)
2. `NCEngine.initialize({ appKey, areaCode })`
3. `NCCallEngine.initialize({})` + call event handlers (`apps/web/src/lib/nexconn-call.ts`)
4. `NCChatUIApplication.initialize({ hooks, language: 'en_US' })` with `reqUserProfiles`, `reqGroupProfiles`, `reqGroupMembers`, and `reqSystemProfiles`
5. `app.ready()`
6. `NCEngine.connect({ token })`
7. Mount `nc-chat-ui-app-provider` / `nc-channel-detail-provider` and `openChannel`
8. Profiles resolve through `POST /api/v1/nexconn/profiles`

Area code defaults to `AreaCode.SG` (`NEXCONN_AREA_CODE`). The token response returns `appKey`; no `NEXT_PUBLIC_NEXCONN_APP_KEY` is required.

Call init failures are non-fatal: Chat continues if Call SDK cannot initialize. Incoming/outgoing call UI lives in `NexconnCallOverlay` (mounted from `AppShell`). Channel headers expose audio/video call actions for direct peers and group members.

## Tokens and server API

`POST /api/v1/nexconn/token` issues a token only for the signed-in FieldOps user. The API calls `POST https://{host}/v4/auth/access-token/issue` with headers `App-Key`, `Nonce`, `Timestamp`, and `Signature = sha1(AppSecret + Nonce + Timestamp)`. Default host is `api.sg-light-api.com` (`NEXCONN_API_BASE_URL`).

Nexconn user ids and group channel ids allow letters and numbers only, 64 characters maximum. Incident channels use ids such as `inc2026000001`, mapped to business number `INC-2026-0001`.

Group create is `POST /v4/group-channel/create`. Direct channels open with `DirectChannelIdentifier` after `ready()` and are not created on the server.

## Calls

Call SDK for Web needs HTTPS (or `localhost`) and microphone/camera permission. Direct calls use the peer `nexconnUserId`. Group calls resolve members via `POST /api/v1/nexconn/group-members` and start `NCCallType.MULTI`. Audio/video media uses `NCCallMediaType.AUDIO` / `AUDIO_VIDEO`. Console prerequisite: enable the Nexconn audio and video calling service for the App Key.

## Messages, media, and webhooks

Chat images, files, GIFs, and voice use `Helper.createSend*MessageParams(file)` and `sendMediaMessage` (`apps/web/src/lib/nexconn-media.ts`). That upload path is Nexconn's, not Cloudinary.

Webhooks: `message:send`, `message:delete`, `group_channel:operation`, `user:connection_status`. Verify `sha1(AppSecret + Nonce + Timestamp)`. Respond `2xx` within 5 seconds, store the event `id`, and enqueue BullMQ work. `POST /api/v1/nexconn/webhooks` implements this.

Without `NEXCONN_APP_KEY` / `NEXCONN_APP_SECRET`, channel provisioning stays `PENDING` and the Chat UI reports that Nexconn is not configured.
