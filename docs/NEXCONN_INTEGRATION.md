# Nexconn integration

Implemented in Phase 2. Packages: `@nexconn/engine` and `@nexconn/chat` `26.2.1`, `@nexconn/chatui` `26.2.5`, `@nexconn/call` `26.2.1`.

## Client lifecycle

`apps/web/src/components/nexconn-chat.tsx` loads only in the browser:

1. `NCCallEngine.install()` (Call SDK Chat bridge; once, before Engine init)
2. `NCEngine.initialize({ appKey, areaCode })`
3. `NCCallEngine.initialize({})` + call event handlers (`apps/web/src/lib/nexconn-call.ts`)
4. `NCChatUIApplication.initialize({ hooks, language: 'en_US' })` with `reqUserProfiles`, `reqGroupProfiles`, `reqGroupMembers`, and `reqSystemProfiles`
5. `app.ready()`
6. `NCEngine.connect({ token })` **once per app session**
7. Mount `nc-chat-ui-app-provider` / `nc-channel-detail-provider` and `openChannel`
8. Profiles resolve through `POST /api/v1/nexconn/profiles`

Area code defaults to `AreaCode.SG` (`NEXCONN_AREA_CODE`). The token response returns `appKey`; no `NEXT_PUBLIC_NEXCONN_APP_KEY` is required.

### Connection robustness

Nexconn’s Web SDK auto-reconnects after the first successful `connect`. FieldOps must not call `disconnect`/`connect` again for transient `30001` / `30011` socket events or for channel membership errors such as `39005`.

- Connect is single-flight (one in-flight promise shared by `NexconnSession` and `NexconnChat`).
- After the first successful connect, status updates come from `ConnectionStatusHandler`; the app waits for `CONNECTED` instead of opening a second socket.
- Fresh-token reconnect only for auth codes (`31004`, `31005`, `31020`).
- Kick / multi-device codes surface as `Authentication required`.
- `openChannel` failures that are membership/permission related (`22406`) never trigger reconnect.
- ChatUI `openChannel` code `39005` is `CHANNEL_LIST_NOT_READY` — ChatUI has not finished `_getRemoteChannelsFinished` **and** `_pullOfflineMessageFinished`. On Web the channel list is **not cached locally**, so every connect re-fetches it from Nexconn.
- Right after connect, engine conversation-list APIs often return `35011` (`METHOD_NOT_AVAILABLE`) until ultra-group sync (`ugSynced` / `ultraGroupEnable`) finishes. ChatUI’s first `_getMoreRemoteChannels(true)` **does not retry** on that failure, which can leave the UI stuck on “Syncing…” forever. Re-calling `NCEngine.initialize` (`A_INIT_REPEAT`) also resets `ugSynced` and restarts the `35011` window.
- FieldOps: initialize the engine once per app key; gate `ChannelsQuery.loadNextPage` for transient `35011`; after ~10s of `39005`, force ChatUI’s internal ready flags and open the known channel id (ChatUI synthesizes a list row if missing); keep a loading state and only surface a hard error if open still fails. This is not a membership error (`22406`).

Call init failures are non-fatal: Chat continues if Call SDK cannot initialize. Incoming/outgoing call UI lives in `NexconnCallOverlay` (mounted from `AppShell`). Channel headers expose audio/video call actions for direct peers and group members.

## Tokens and server API

`POST /api/v1/nexconn/token` issues a token only for the signed-in FieldOps user. The API calls `POST https://{host}/v4/auth/access-token/issue` with headers `App-Key`, `Nonce`, `Timestamp`, and `Signature = sha1(AppSecret + Nonce + Timestamp)`. Default host is `api.sg-light-api.com` (`NEXCONN_API_BASE_URL`).

Nexconn user ids and group channel ids allow letters and numbers only, 64 characters maximum. Incident channels use ids such as `inc2026000001`, mapped to business number `INC-2026-0001`.

Group create is `POST /v4/group-channel/create`. Direct channels open with `DirectChannelIdentifier` after `ready()` and are not created on the server.

## Calls

Call SDK for Web needs HTTPS (or `localhost`) and microphone/camera permission. Direct calls use the peer `nexconnUserId`. Group calls resolve members via `POST /api/v1/nexconn/group-members` and start `NCCallType.MULTI`. Audio/video media uses `NCCallMediaType.AUDIO` / `AUDIO_VIDEO`. Console prerequisite: enable the Nexconn audio and video calling service for the App Key.

## Speech-to-text (STT)

Nexconn ships built-in STT in Chat + ChatUI:

- Chat SDK: `Message.requestSpeechToText()`, `NCEngine.getAppSettings().isSpeechToTextEnabled`, `MessageHandler.onSpeechToTextCompleted`
- ChatUI: message menu **Transcribe** / **Cancel Transcribe** on HD voice (`RC:HQVCMsg`) when `isSpeechToTextEnabled` is true

FieldOps wiring (`apps/web/src/lib/nexconn-stt.ts`):

1. After connect, refresh `getAppSettings()` and show an `STT` badge when enabled
2. Ensure ChatUI message-menu STT ids are present before `ready()`
3. Web voice notes via `Helper.createSendHDVoiceMessageParams` + ChatUI `app.sendMessage` (`sendChatVoice`) — ChatUI Web cannot record voice itself. Sending only through `Channel.sendMediaMessage` can upload to S3 (204) without updating the open ChatUI channel; always prefer `app.sendMessage`.
4. When console STT is enabled, FieldOps auto-calls `message.requestSpeechToText()` after a successful voice send so transcript text can appear under the bubble

Console prerequisite: enable the Nexconn **voice-to-text** service for the App Key. Without it, Transcribe stays hidden and requests return `28300`. Usage: record a voice note (mic) → bubble appears → transcript fills in when STT succeeds (or right-click → **Transcribe**).

## Messages, media, and webhooks

Chat images, files, GIFs, and voice use `Helper.createSend*MessageParams(file)` and `sendMediaMessage` (`apps/web/src/lib/nexconn-media.ts`). That upload path is Nexconn's, not Cloudinary.

Webhooks: `message:send`, `message:delete`, `group_channel:operation`, `user:connection_status`. Verify `sha1(AppSecret + Nonce + Timestamp)`. Respond `2xx` within 5 seconds, store the event `id`, and enqueue BullMQ work. `POST /api/v1/nexconn/webhooks` implements this.

Without `NEXCONN_APP_KEY` / `NEXCONN_APP_SECRET`, channel provisioning stays `PENDING` and the Chat UI reports that Nexconn is not configured.
