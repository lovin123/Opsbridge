"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Box, Callout, Card, Flex, IconButton, Text, Tooltip } from "@radix-ui/themes";
import { Mic, Phone, Square, Video } from "lucide-react";
import { api } from "@/lib/api";
import { LoadingBlock } from "@/components/page";
import { useSession } from "@/components/providers";
import { useUiStore } from "@/store/ui-store";
import {
  ensureNexconnCallReady,
  installNexconnCallBridge,
  resetNexconnCall,
  resolveGroupCalleeIds,
  startNexconnCall,
  type CallMediaKind,
} from "@/lib/nexconn-call";
import { installNexconnAudioPlayPatch, toNexconnHdVoiceFile } from "@/lib/nexconn-audio";
import { sendChatVoice } from "@/lib/nexconn-media";
import {
  ensureChatUiSttMessageMenu,
  getSttAvailability,
  refreshNexconnSttAvailability,
  resetSttAvailability,
  subscribeSttAvailability,
} from "@/lib/nexconn-stt";

interface TokenResponse {
  token: string;
  userId: string;
  appKey: string;
  areaCode: string;
}

type ChatApp = NonNullable<ReturnType<(typeof import("@nexconn/chatui"))["NCChatUIApplication"]["initialize"]>>;

type StatusLabel =
  | "Disconnected"
  | "Connecting"
  | "Connected"
  | "Reconnecting"
  | "Authentication required";

const EMPTY_AVATAR = "";
const STATUS_HANDLER_ID = "opsbridge-nexconn-status";
const MODAL_ROOT_ID = "nexconn-modal-root";
const MAX_BOOT_ATTEMPTS = 3;
const BOOT_RETRY_BASE_MS = 1500;
const WAIT_CONNECTED_MS = 20_000;
/** Token / auth codes that require a fresh token + explicit connect. */
const TOKEN_ERROR_CODES = new Set([31004, 31005, 31020]);
/** Kick / multi-device codes — do not auto-reconnect; user must re-auth. */
const AUTH_BLOCK_CODES = new Set([31009, 31010, 31011, 31023]);
/**
 * ChatUI openChannel 39005 = CHANNEL_LIST_NOT_READY (list still syncing after connect).
 * Not a disconnect and not “not a member” — retry after a short wait.
 */
const CHANNEL_LIST_NOT_READY = 39005;
/**
 * Engine ErrorCode.METHOD_NOT_AVAILABLE — conversation-list APIs return this while
 * ultra-group sync (`ugSynced`) is still false after connect (navi ugMsg+sessionCfg).
 */
const METHOD_NOT_AVAILABLE = 35011;
/** Shared wait for conversation-list APIs to leave the post-connect 35011 window. */
const CHANNEL_LIST_FETCH_GATE_MS = 30_000;
/**
 * If ChatUI is still returning 39005 after this, force its internal ready flags and open
 * the known channel id (ChatUI will synthesize a list row when missing).
 */
const FORCE_CHATUI_READY_AFTER_MS = 10_000;
/** Cap openChannel retries so sync cannot hang the UI forever. */
const OPEN_CHANNEL_MAX_MS = 90_000;
/** True group membership denial from Nexconn (user not in the group). */
const GROUP_NOT_MEMBER = 22406;
/** Membership / permission failures — never reconnect for these. */
const MEMBERSHIP_ERROR_RE = /22406|not in group|not a member|permission/i;

let bootPromise: Promise<ChatApp> | null = null;
let bootedApp: ChatApp | null = null;
let bootedUserId: string | null = null;
let pendingUserId: string | null = null;
let lastToken: TokenResponse | null = null;
let connectionStatus: StatusLabel = "Disconnected";
let bootRetryTimer: ReturnType<typeof setTimeout> | null = null;
let bootAttempt = 0;
/** True after the first successful NCEngine.connect in this session. */
let hasConnectedOnce = false;
/** Single-flight connect so Chat UI + Session never race sockets. */
let connectInFlight: Promise<void> | null = null;
let statusHandlerInstalled = false;
let destroying = false;
let statusHandlerUserId: string | null = null;
let channelListFetchGateInstalled = false;
let engineInitializedAppKey: string | null = null;
/** Single-flight probe so ChatUI + openChannel share one 35011 wait. */
let conversationListReadyPromise: Promise<boolean> | null = null;
const statusListeners = new Set<(status: StatusLabel) => void>();

type ChatUiChannelModule = {
  _getRemoteChannelsFinished?: boolean;
  _pullOfflineMessageFinished?: boolean;
  _getMoreRemoteChannels?: (reset?: boolean) => Promise<void>;
};

function getChatUiChannelModule(app: ChatApp): ChatUiChannelModule | null {
  return (app as unknown as { _ctx?: { channelModule?: ChatUiChannelModule } })._ctx?.channelModule ?? null;
}

function publishStatus(status: StatusLabel) {
  connectionStatus = status;
  statusListeners.forEach((listener) => listener(status));
}

export function useNexconnStatus() {
  const [status, setStatus] = useState(connectionStatus);
  useEffect(() => {
    statusListeners.add(setStatus);
    return () => {
      statusListeners.delete(setStatus);
    };
  }, []);
  return status;
}

export function getBootedNexconnChatApp() {
  return bootedApp;
}

function clearBootRetryTimer() {
  if (bootRetryTimer) {
    clearTimeout(bootRetryTimer);
    bootRetryTimer = null;
  }
}

function isChannelListNotReady(code: number | undefined, message?: string) {
  return code === CHANNEL_LIST_NOT_READY || /39005|CHANNEL_LIST_NOT_READY|channel list/i.test(message ?? "");
}

function isMembershipOpenError(code: number | undefined, message?: string) {
  if (code === GROUP_NOT_MEMBER) {
    return true;
  }
  // Do not treat 39005 as membership — that is CHANNEL_LIST_NOT_READY per ChatUI docs.
  if (code === CHANNEL_LIST_NOT_READY) {
    return false;
  }
  return Boolean(message && MEMBERSHIP_ERROR_RE.test(message));
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

type ChannelsQueryPage = {
  isOk?: boolean;
  code?: number;
  msg?: string;
};

async function loadConversationListPageRaw(
  chat: typeof import("@nexconn/chat"),
): Promise<ChannelsQueryPage> {
  const query = chat.BaseChannel.createChannelsQuery({ pageSize: 1 });
  const proto = Object.getPrototypeOf(query) as {
    loadNextPage?: (this: unknown, ...args: unknown[]) => Promise<ChannelsQueryPage>;
    __opsbridgeOriginalLoadNextPage?: (this: unknown, ...args: unknown[]) => Promise<ChannelsQueryPage>;
  };
  const load = proto.__opsbridgeOriginalLoadNextPage ?? proto.loadNextPage;
  if (!load) {
    return { isOk: false, code: METHOD_NOT_AVAILABLE };
  }
  return load.call(query);
}

/**
 * Poll the raw conversation-list API until it leaves the 35011 window (or times out).
 * Shared so ChatUI + openChannelReliable wait on one probe (avoids nested 30s gates).
 */
function ensureConversationListApiReady(
  chat: typeof import("@nexconn/chat"),
  options: { isCancelled?: () => boolean; timeoutMs?: number } = {},
): Promise<boolean> {
  if (!conversationListReadyPromise) {
    const timeoutMs = options.timeoutMs ?? CHANNEL_LIST_FETCH_GATE_MS;
    conversationListReadyPromise = (async () => {
      const started = Date.now();
      while (!options.isCancelled?.()) {
        if (chat.NCEngine.getConnectionStatus() !== chat.ConnectionStatus.CONNECTED) {
          await sleep(400);
          if (Date.now() - started >= timeoutMs) {
            return false;
          }
          continue;
        }
        try {
          const page = await loadConversationListPageRaw(chat);
          const code = typeof page?.code === "number" ? page.code : undefined;
          if (page?.isOk || code === 0) {
            return true;
          }
          if (code !== METHOD_NOT_AVAILABLE) {
            return false;
          }
        } catch {
          // keep polling through transient SDK errors
        }
        if (Date.now() - started >= timeoutMs) {
          return false;
        }
        await sleep(500);
      }
      return false;
    })();
  }
  return conversationListReadyPromise;
}

/**
 * ChatUI `_getMoreRemoteChannels(true)` on CONNECTED does not retry when the first
 * `createChannelsQuery().loadNextPage()` fails. Right after connect, engine often
 * returns 35011 until ultra-group sync finishes — ChatUI then leaves
 * `_getRemoteChannelsFinished=false` forever and every `openChannel` is 39005.
 * Gate loadNextPage behind a shared 35011 wait so ChatUI's first fetch can succeed.
 */
function installChannelListFetchGate(chat: typeof import("@nexconn/chat")) {
  if (channelListFetchGateInstalled || typeof window === "undefined") {
    return;
  }
  try {
    const probe = chat.BaseChannel.createChannelsQuery({ pageSize: 1 });
    const proto = Object.getPrototypeOf(probe) as {
      loadNextPage?: (this: unknown, ...args: unknown[]) => Promise<ChannelsQueryPage>;
      __opsbridgeListGate?: boolean;
      __opsbridgeOriginalLoadNextPage?: (this: unknown, ...args: unknown[]) => Promise<ChannelsQueryPage>;
    };
    if (!proto?.loadNextPage || proto.__opsbridgeListGate) {
      channelListFetchGateInstalled = true;
      return;
    }
    const original = proto.loadNextPage;
    proto.__opsbridgeOriginalLoadNextPage = original;
    proto.loadNextPage = async function opsbridgeGatedLoadNextPage(...args: unknown[]) {
      // Avoid recursion: the shared waiter calls loadNextPage on new queries.
      // Use a short direct retry loop with the original implementation.
      const started = Date.now();
      for (;;) {
        const result = await original.apply(this, args);
        const code = typeof result?.code === "number" ? result.code : undefined;
        const ok = Boolean(result?.isOk) || code === 0;
        if (ok || code !== METHOD_NOT_AVAILABLE) {
          return result;
        }
        if (Date.now() - started >= CHANNEL_LIST_FETCH_GATE_MS) {
          return result;
        }
        await sleep(500);
      }
    };
    proto.__opsbridgeListGate = true;
    channelListFetchGateInstalled = true;
  } catch {
    // Gate is best-effort; openChannelReliable still forces ChatUI ready as a fallback.
  }
}

/**
 * Web Chat does not cache the channel list locally — after connect it re-fetches from Nexconn.
 * Wait for ChannelHandler.onChannelsSyncComplete (or timeout) before openChannel.
 */
function waitForChannelsSyncComplete(
  chat: typeof import("@nexconn/chat"),
  timeoutMs = 25_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const handlerId = `opsbridge-channels-sync-${Date.now()}`;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        chat.NCEngine.removeChannelHandler(handlerId);
      } catch {
        // ignore
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      chat.NCEngine.addChannelHandler(
        handlerId,
        new chat.ChannelHandler({
          onChannelsSyncComplete() {
            finish(true);
          },
          onChannelStatusSyncCompleted() {
            // Status sync often lands with / right after the list; treat as ready enough.
            finish(true);
          },
          onCommunityChannelsSyncCompleted() {
            // ultraGroupEnable → this callback; list APIs become available after ugSynced.
            finish(true);
          },
        }),
      );
    } catch {
      finish(false);
    }
  });
}

function waitForOfflineMessageSync(
  chat: typeof import("@nexconn/chat"),
  timeoutMs = 25_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const handlerId = `opsbridge-offline-sync-${Date.now()}`;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        chat.NCEngine.removeMessageHandler(handlerId);
      } catch {
        // ignore
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      chat.NCEngine.addMessageHandler(
        handlerId,
        new chat.MessageHandler({
          onOfflineMessageSyncCompleted() {
            finish(true);
          },
        }),
      );
    } catch {
      finish(false);
    }
  });
}

/**
 * If ChatUI already burned its non-retrying init fetch, kick the retrying path
 * (`_getMoreRemoteChannels(false)`) once the conversation-list API is healthy.
 */
function kickChatUiChannelListReload(app: ChatApp) {
  const channelModule = getChatUiChannelModule(app);
  const reload = channelModule?._getMoreRemoteChannels;
  if (channelModule && typeof reload === "function") {
    void reload.call(channelModule, false);
  }
}

/**
 * Bypass ChatUI's stuck sync gates. openChannel only checks these two flags; when the
 * channel id is known, ChatUI synthesizes a list row if it is missing.
 */
function forceChatUiChannelReady(app: ChatApp): boolean {
  const channelModule = getChatUiChannelModule(app);
  if (!channelModule) {
    return false;
  }
  channelModule._getRemoteChannelsFinished = true;
  channelModule._pullOfflineMessageFinished = true;
  return true;
}

function ensureModalRoot() {
  if (typeof document === "undefined") {
    return;
  }
  if (!document.getElementById(MODAL_ROOT_ID)) {
    const root = document.createElement("div");
    root.id = MODAL_ROOT_ID;
    document.body.appendChild(root);
  }
}

function userProfile(userId: string, name?: string, avatarUrl?: string) {
  return {
    userId,
    name: (name || userId).slice(0, 64),
    avatarUrl: typeof avatarUrl === "string" ? avatarUrl : EMPTY_AVATAR,
  };
}

function groupProfile(groupId: string, name?: string, memberCount = 0, avatarUrl?: string) {
  return {
    groupId,
    name: (name || groupId).slice(0, 64),
    memberCount: Number.isFinite(memberCount) && memberCount >= 0 ? memberCount : 0,
    avatarUrl: typeof avatarUrl === "string" ? avatarUrl : EMPTY_AVATAR,
  };
}

/**
 * ChatUI may open a synthesized channel row (id-only) after sync bypass.
 * Push Opsbridge channel/user display data without touching connect/open flow.
 * Never stamp memberCount: 0 before the API returns — that races and overwrites a real count.
 */
async function hydrateOpenedChannelProfile(
  app: ChatApp,
  channelId: string,
  mode: "group" | "direct",
  title?: string,
) {
  if (!app.ifReady()) {
    return;
  }
  const knownName = title?.trim();
  try {
    if (mode === "group") {
      const orgId = useUiStore.getState().organizationId;
      const profiles = await api<{
        groups: Array<{ groupId: string; name: string; memberCount?: number; avatarUrl?: string }>;
      }>("/nexconn/profiles", { method: "POST", body: { groupIds: [channelId] }, orgId });
      const match = (profiles.groups ?? []).find((group) => group.groupId === channelId);
      let memberCount = match?.memberCount ?? 0;
      // Site channels can report 0 until profiles exist — fall back to member list length.
      if (memberCount === 0) {
        try {
          const members = await api<Array<{ userId: string }>>("/nexconn/group-members", {
            method: "POST",
            body: { groupId: channelId },
            orgId,
          });
          memberCount = (members ?? []).filter((m) => typeof m?.userId === "string" && m.userId.length > 0).length;
        } catch {
          // keep 0
        }
      }
      app.updateGroupProfile(
        groupProfile(channelId, match?.name || knownName, memberCount, match?.avatarUrl),
      );
      return;
    }

    const orgId = useUiStore.getState().organizationId;
    const profiles = await api<{
      users: Array<{ userId: string; name: string; avatarUrl?: string }>;
    }>("/nexconn/profiles", { method: "POST", body: { userIds: [channelId] }, orgId });
    const match = (profiles.users ?? []).find((user) => user.userId === channelId);
    app.updateUserProfile(userProfile(channelId, match?.name || knownName, match?.avatarUrl));
  } catch {
    // Display-only — never fail the open path. Name-only update; omit count to avoid forcing 0.
    try {
      if (mode === "group" && knownName) {
        app.updateGroupProfile(groupProfile(channelId, knownName, 0));
      } else if (mode === "direct" && knownName) {
        app.updateUserProfile(userProfile(channelId, knownName));
      }
    } catch {
      // ignore
    }
  }
}

/**
 * ChatUI renders `nc-channel-detail-bar-provider` inside the channel provider shadow root,
 * so page CSS cannot hide it. Pierce once (and watch briefly) for channel embeds only.
 */
function hideChatUiChannelDetailBar(host: HTMLElement): () => void {
  let stopped = false;
  const hide = () => {
    if (stopped) return true;
    const provider =
      (host.querySelector("nc-channel-detail-provider") as HTMLElement | null) ??
      (host.firstElementChild as HTMLElement | null);
    const shadow = provider?.shadowRoot;
    if (!shadow) return false;
    // Persist across Lit re-renders of the bar host.
    const styleId = "opsbridge-hide-channel-detail-bar";
    if (!shadow.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        nc-channel-detail-bar-provider {
          display: none !important;
          height: 0 !important;
          min-height: 0 !important;
          overflow: hidden !important;
          pointer-events: none !important;
        }
      `;
      shadow.appendChild(style);
    }
    const bar = shadow.querySelector("nc-channel-detail-bar-provider") as HTMLElement | null;
    if (!bar) return false;
    bar.setAttribute("hidden", "");
    bar.style.setProperty("display", "none", "important");
    bar.style.setProperty("height", "0", "important");
    bar.style.setProperty("min-height", "0", "important");
    bar.style.setProperty("overflow", "hidden", "important");
    bar.style.setProperty("pointer-events", "none", "important");
    return true;
  };

  if (hide()) {
    return () => {
      stopped = true;
    };
  }

  const observer = new MutationObserver(() => {
    if (hide()) {
      observer.disconnect();
    }
  });
  observer.observe(host, { childList: true, subtree: true });
  // Also watch when the custom element upgrades and attaches a shadow root.
  const timer = window.setInterval(() => {
    if (hide()) {
      window.clearInterval(timer);
      observer.disconnect();
    }
  }, 250);
  const timeout = window.setTimeout(() => {
    window.clearInterval(timer);
    observer.disconnect();
  }, 20_000);

  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.clearTimeout(timeout);
    observer.disconnect();
  };
}

async function fetchToken(): Promise<TokenResponse> {
  const token = await api<TokenResponse>("/nexconn/token", { method: "POST" });
  if (!token.appKey || !token.token) {
    throw new Error("Nexconn is not configured");
  }
  lastToken = token;
  return token;
}

async function ensureEngineConnected(
  chat: typeof import("@nexconn/chat"),
  options: { refreshToken?: boolean } = {},
): Promise<void> {
  // Always join an in-flight connect instead of opening a second socket.
  if (connectInFlight) {
    await connectInFlight;
    if (chat.NCEngine.getConnectionStatus() === chat.ConnectionStatus.CONNECTED) {
      publishStatus("Connected");
      return;
    }
  }

  const status = chat.NCEngine.getConnectionStatus();
  if (status === chat.ConnectionStatus.CONNECTED) {
    hasConnectedOnce = true;
    bootAttempt = 0;
    publishStatus("Connected");
    return;
  }

  // SDK auto-reconnects after the first successful connect. Wait — do not call connect again.
  if (
    !options.refreshToken &&
    (status === chat.ConnectionStatus.CONNECTING ||
      status === chat.ConnectionStatus.SUSPENDED ||
      (hasConnectedOnce && status === chat.ConnectionStatus.DISCONNECTED))
  ) {
    publishStatus(hasConnectedOnce ? "Reconnecting" : "Connecting");
    await waitForConnected(chat, WAIT_CONNECTED_MS);
    return;
  }

  connectInFlight = (async () => {
    publishStatus(hasConnectedOnce ? "Reconnecting" : "Connecting");
    const token = options.refreshToken ? await fetchToken() : (lastToken ?? (await fetchToken()));
    let connected = await chat.NCEngine.connect({ token: token.token });
    if (!connected.isOk && !TOKEN_ERROR_CODES.has(connected.code ?? -1)) {
      // One soft retry with a fresh token only when the first connect fails.
      const fresh = await fetchToken();
      connected = await chat.NCEngine.connect({ token: fresh.token });
    } else if (!connected.isOk && TOKEN_ERROR_CODES.has(connected.code ?? -1)) {
      const fresh = await fetchToken();
      connected = await chat.NCEngine.connect({ token: fresh.token });
    }
    if (!connected.isOk) {
      throw new Error(connected.msg || `Nexconn connection failed (${connected.code ?? "?"})`);
    }
    hasConnectedOnce = true;
    bootAttempt = 0;
    publishStatus("Connected");
  })().finally(() => {
    connectInFlight = null;
  });

  await connectInFlight;
}

function waitForConnected(chat: typeof import("@nexconn/chat"), timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (destroying) {
        reject(new Error("Nexconn session ended"));
        return;
      }
      const status = chat.NCEngine.getConnectionStatus();
      if (status === chat.ConnectionStatus.CONNECTED) {
        hasConnectedOnce = true;
        bootAttempt = 0;
        publishStatus("Connected");
        resolve();
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error("Nexconn connection timed out"));
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

/** Retry initial boot only (before first connect). Never fights SDK auto-reconnect. */
function scheduleBootRetry(userId: string) {
  if (destroying || hasConnectedOnce) {
    return;
  }
  if (pendingUserId !== userId && bootedUserId !== userId) {
    return;
  }
  clearBootRetryTimer();
  bootAttempt += 1;
  if (bootAttempt > MAX_BOOT_ATTEMPTS) {
    publishStatus("Authentication required");
    return;
  }
  publishStatus("Connecting");
  const delay = BOOT_RETRY_BASE_MS * 2 ** (bootAttempt - 1);
  bootRetryTimer = setTimeout(() => {
    void (async () => {
      try {
        const token = await fetchToken();
        await bootChat(token, userId);
      } catch {
        scheduleBootRetry(userId);
      }
    })();
  }, delay);
}

async function refreshTokenAndConnect(chat: typeof import("@nexconn/chat")) {
  if (destroying) {
    return;
  }
  try {
    await ensureEngineConnected(chat, { refreshToken: true });
  } catch {
    publishStatus("Authentication required");
  }
}

async function installStatusHandler(chat: typeof import("@nexconn/chat"), userId: string) {
  statusHandlerUserId = userId;
  if (statusHandlerInstalled) {
    return;
  }
  const handler = new chat.ConnectionStatusHandler({
    onConnectionStatusChanged(event) {
      if (destroying) {
        return;
      }
      const code = event.code;

      if (event.status === chat.ConnectionStatus.CONNECTED) {
        clearBootRetryTimer();
        hasConnectedOnce = true;
        bootAttempt = 0;
        publishStatus("Connected");
        return;
      }

      if (AUTH_BLOCK_CODES.has(code ?? -1)) {
        publishStatus("Authentication required");
        return;
      }

      if (TOKEN_ERROR_CODES.has(code ?? -1)) {
        publishStatus("Reconnecting");
        void refreshTokenAndConnect(chat);
        return;
      }

      if (event.status === chat.ConnectionStatus.CONNECTING) {
        publishStatus(hasConnectedOnce ? "Reconnecting" : "Connecting");
        return;
      }

      if (event.status === chat.ConnectionStatus.SUSPENDED) {
        // SDK reconnects automatically after ~5s — do not call connect().
        publishStatus("Reconnecting");
        return;
      }

      if (event.status === chat.ConnectionStatus.DISCONNECTED) {
        if (hasConnectedOnce) {
          // Transient 30001/30011: SDK auto-reconnects. Do not open a second socket.
          publishStatus("Reconnecting");
          return;
        }
        publishStatus("Disconnected");
        if (statusHandlerUserId) {
          scheduleBootRetry(statusHandlerUserId);
        }
      }
    },
  });
  chat.NCEngine.addConnectionStatusHandler(STATUS_HANDLER_ID, handler);
  statusHandlerInstalled = true;
}

function configureChatUi(app: ChatApp, ui: typeof import("@nexconn/chatui")) {
  // Chat UI SDK forbids command/bubble config after ready().
  if (app.ifReady()) {
    return;
  }

  try {
    app.setCommandSwitch(ui.ChatUICommand.SHOW_MESSAGE_STATE, true);
    app.setCommandSwitch(ui.ChatUICommand.SHOW_CONNECTION_STATUS_IN_CHANNEL_LIST, true);
    app.setCommandSwitch(ui.ChatUICommand.MENTION_ALL, true);

    // Keep built-in Transcribe / Cancel Transcribe entries (gated at runtime by AppSettings).
    ensureChatUiSttMessageMenu(app, ui);

    const bubble = app.cloneMessageBubbleConfig();
    bubble.layout = ui.BubbleLayout.LEFT_RIGHT;
    bubble.redius = 14;
    // Soft indigo / slate to match Opsbridge Theme accent.
    bubble.backgroundColorForMyself = 0xe0e7ff;
    bubble.backgroundColorForOthers = 0xf1f5f9;
    bubble.textColorForMyself = 0x0f172a;
    bubble.textColorForOthers = 0x0f172a;
    bubble.showOthersNameInGroupChannel = true;
    bubble.showOthersProfileInGroupChannel = true;
    bubble.showOthersProfileInDirectionChannel = true;
    app.setMessageBubbleConfig(bubble);
  } catch {
    // Ignore if the SDK instance was already marked ready by a prior boot.
  }
}

export async function destroyNexconnSession() {
  destroying = true;
  clearBootRetryTimer();
  const app = bootedApp;
  const chatModule = await import("@nexconn/chat").catch(() => null);
  bootPromise = null;
  bootedApp = null;
  bootedUserId = null;
  pendingUserId = null;
  lastToken = null;
  bootAttempt = 0;
  hasConnectedOnce = false;
  connectInFlight = null;
  statusHandlerUserId = null;
  engineInitializedAppKey = null;
  conversationListReadyPromise = null;
  publishStatus("Disconnected");
  resetSttAvailability();
  await resetNexconnCall().catch(() => undefined);
  if (chatModule && statusHandlerInstalled) {
    try {
      chatModule.NCEngine.removeConnectionStatusHandler(STATUS_HANDLER_ID);
    } catch {
      // ignore
    }
    statusHandlerInstalled = false;
  }
  if (app) {
    try {
      app.destroy();
    } catch {
      // SDK teardown is best-effort on sign-out.
    }
  }
  if (chatModule) {
    try {
      await chatModule.NCEngine.disconnect?.();
    } catch {
      // ignore
    }
  }
  destroying = false;
}

export function NexconnSession() {
  const session = useSession();
  useEffect(() => {
    if (!session.data) {
      return;
    }
    let cancelled = false;
    const userId = session.data.user.id;
    if (connectionStatus === "Disconnected") {
      publishStatus("Connecting");
    }
    void (async () => {
      try {
        const token = await fetchToken();
        if (cancelled) {
          return;
        }
        await bootChat(token, userId);
      } catch {
        if (!cancelled) {
          scheduleBootRetry(userId);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.data?.user.id]);
  return null;
}

async function bootChat(session: TokenResponse, userId: string): Promise<ChatApp> {
  if (bootPromise && (bootedUserId === userId || pendingUserId === userId)) {
    return bootPromise;
  }
  if (bootedApp && bootedUserId === userId && !bootPromise) {
    const chat = await import("@nexconn/chat");
    await ensureEngineConnected(chat);
    return bootedApp;
  }
  if (
    (bootedUserId || pendingUserId) &&
    bootedUserId !== userId &&
    pendingUserId !== userId
  ) {
    await destroyNexconnSession();
  }

  pendingUserId = userId;
  lastToken = session;
  const thisBoot = (async () => {
    ensureModalRoot();
    // Prevent ChatUI HTMLAudioElement.play() NotSupportedError from becoming an unhandledRejection.
    installNexconnAudioPlayPatch();
    // Call SDK must install its Chat bridge before NCEngine.initialize.
    await installNexconnCallBridge();
    const chat = await import("@nexconn/chat");
    const ui = await import("@nexconn/chatui");
    const area = chat.AreaCode[session.areaCode as keyof typeof chat.AreaCode] ?? chat.AreaCode.SG;

    // Order required by Chat UI + Call: install Call → NCEngine → NCCallEngine → ChatUI → ready → connect.
    // Never re-initialize the same appKey — A_INIT_REPEAT resets ugSynced and restarts 35011.
    if (engineInitializedAppKey !== session.appKey) {
      chat.NCEngine.initialize({
        appKey: session.appKey,
        areaCode: area,
        logLevel: chat.LogLevel.WARN,
      });
      engineInitializedAppKey = session.appKey;
      conversationListReadyPromise = null;
    }
    // Must be before connect: ChatUI fetches the channel list on CONNECTED with no retry on 35011.
    installChannelListFetchGate(chat);
    // Call init failures must not block Chat.
    await ensureNexconnCallReady(session.userId).catch(() => false);
    await installStatusHandler(chat, userId);

    let app = bootedApp;
    if (!app) {
      const created = ui.NCChatUIApplication.initialize({
        language: "en_US",
        modalContainerId: MODAL_ROOT_ID,
        hooks: {
          async reqUserProfiles(userIds: string[]) {
            const ids = (userIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0);
            try {
              const orgId = useUiStore.getState().organizationId;
              const profiles = await api<{ users: Array<{ userId: string; name: string; avatarUrl?: string }> }>(
                "/nexconn/profiles",
                { method: "POST", body: { userIds: ids }, orgId },
              );
              const byId = new Map((profiles.users ?? []).map((user) => [user.userId, user]));
              return ids.map((userId) => {
                const match = byId.get(userId);
                return userProfile(userId, match?.name, match?.avatarUrl);
              });
            } catch {
              return ids.map((userId) => userProfile(userId));
            }
          },
          async reqGroupProfiles(groupIds: string[]) {
            const ids = (groupIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0);
            try {
              const orgId = useUiStore.getState().organizationId;
              const profiles = await api<{
                groups: Array<{ groupId: string; name: string; memberCount?: number; avatarUrl?: string }>;
              }>("/nexconn/profiles", { method: "POST", body: { groupIds: ids }, orgId });
              const byId = new Map((profiles.groups ?? []).map((group) => [group.groupId, group]));
              return ids.map((groupId) => {
                const match = byId.get(groupId);
                // Prefer mapped Opsbridge name; never leave ChatUI with a bare id when we have one.
                return groupProfile(groupId, match?.name, match?.memberCount ?? 0, match?.avatarUrl);
              });
            } catch {
              return ids.map((groupId) => groupProfile(groupId));
            }
          },
          async reqGroupMembers(groupId: string) {
            try {
              const orgId = useUiStore.getState().organizationId;
              const members = await api<Array<{ userId: string; name?: string; nickname?: string }>>(
                "/nexconn/group-members",
                { method: "POST", body: { groupId }, orgId },
              );
              return (members ?? [])
                .filter((member) => typeof member?.userId === "string" && member.userId.length > 0)
                .map((member) => ({
                  userId: member.userId,
                  nickname: member.nickname || member.name || member.userId,
                }));
            } catch {
              return [];
            }
          },
          async reqSystemProfiles(systemIds: string[]) {
            return (systemIds ?? [])
              .filter((id): id is string => typeof id === "string" && id.length > 0)
              .map((systemId) => ({ systemId, name: "Opsbridge", avatarUrl: EMPTY_AVATAR }));
          },
        },
      });
      if (!created) {
        throw new Error("Chat UI failed to initialize");
      }
      if (!created.ifReady()) {
        configureChatUi(created, ui);
        created.ready();
      }
      app = created;
    }

    await ensureEngineConnected(chat);
    // STT availability comes from post-connect app settings (console voice-to-text service).
    await refreshNexconnSttAvailability(chat).catch(() => undefined);
    bootedUserId = userId;
    pendingUserId = null;
    bootedApp = app;
    return app;
  })().catch((error: unknown) => {
    if (pendingUserId === userId || bootPromise === thisBoot) {
      bootPromise = null;
      pendingUserId = null;
    }
    throw error;
  });

  bootPromise = thisBoot;
  return thisBoot;
}

async function openChannelReliable(
  app: ChatApp,
  channelId: string,
  mode: "group" | "direct",
  options: {
    isCancelled?: () => boolean;
    onWait?: (phase: "syncing" | "reconnecting") => void;
  } = {},
): Promise<void> {
  const chat = await import("@nexconn/chat");
  installChannelListFetchGate(chat);
  await ensureEngineConnected(chat);
  if (!app.ifReady()) {
    app.ready();
  }
  const identifier =
    mode === "group" ? new chat.GroupChannelIdentifier(channelId) : new chat.DirectChannelIdentifier(channelId);

  // ChatUI openChannel needs BOTH remote channel list + offline message pull finished.
  options.onWait?.("syncing");
  const syncGate = waitForChannelsSyncComplete(chat, OPEN_CHANNEL_MAX_MS);
  const offlineGate = waitForOfflineMessageSync(chat, OPEN_CHANNEL_MAX_MS);
  let kickedChatUiReload = false;
  let forcedChatUiReady = false;
  void ensureConversationListApiReady(chat, {
    isCancelled: options.isCancelled,
    timeoutMs: CHANNEL_LIST_FETCH_GATE_MS,
  }).then((ready) => {
    if (ready && !options.isCancelled?.()) {
      kickedChatUiReload = true;
      kickChatUiChannelListReload(app);
    }
  });

  const started = Date.now();
  let attempt = 0;

  while (!options.isCancelled?.()) {
    attempt += 1;
    const opened = await app.openChannel(identifier, true);
    if (!opened || typeof opened.code !== "number" || opened.code === 0) {
      return;
    }

    if (isMembershipOpenError(opened.code, opened.msg)) {
      throw new Error(opened.msg || `fail: ${opened.code}`);
    }

    if (isChannelListNotReady(opened.code, opened.msg)) {
      const elapsed = Date.now() - started;
      options.onWait?.("syncing");

      // UG sync can stall on 35011; ChatUI init also fails once with no retry.
      // After a short wait, force ready flags and open the known channel id.
      if (!forcedChatUiReady && elapsed >= FORCE_CHATUI_READY_AFTER_MS) {
        forcedChatUiReady = forceChatUiChannelReady(app);
        if (forcedChatUiReady) {
          kickChatUiChannelListReload(app);
          continue;
        }
      }

      if (elapsed >= OPEN_CHANNEL_MAX_MS) {
        if (!forcedChatUiReady && forceChatUiChannelReady(app)) {
          forcedChatUiReady = true;
          continue;
        }
        throw new Error(
          "Nexconn channel list did not become ready after connect. Try opening the channel again.",
        );
      }

      if (!kickedChatUiReload && attempt > 2) {
        kickChatUiChannelListReload(app);
      }
      await Promise.race([
        Promise.all([syncGate, offlineGate]),
        sleep(Math.min(1_500, 400 + attempt * 200)),
      ]);
      continue;
    }

    const status = chat.NCEngine.getConnectionStatus();
    if (
      status !== chat.ConnectionStatus.CONNECTED ||
      opened.code === 30001 ||
      opened.code === 30002 ||
      opened.code === 30011
    ) {
      options.onWait?.("reconnecting");
      // Reconnect resets ugSynced — clear the shared probe so we wait again.
      conversationListReadyPromise = null;
      await ensureEngineConnected(chat);
      await sleep(400);
      continue;
    }

    throw new Error(opened.msg || `Could not open channel (${opened.code})`);
  }
}

function statusBadgeColor(status: StatusLabel): "indigo" | "amber" | "red" | "gray" {
  if (status === "Connected") return "indigo";
  if (status === "Connecting" || status === "Reconnecting") return "amber";
  if (status === "Authentication required") return "red";
  return "gray";
}

function mountChatUiHost(node: HTMLElement, layout: "inbox" | "channel") {
  const tag = layout === "inbox" ? "nc-chat-ui-app-provider" : "nc-channel-detail-provider";
  const existing = node.firstElementChild as HTMLElement | null;
  if (existing?.tagName.toLowerCase() === tag) {
    return existing;
  }
  const element = document.createElement(tag);
  element.style.width = "100%";
  element.style.height = "100%";
  element.style.display = "block";
  node.replaceChildren(element);
  return element;
}

export function NexconnChat({
  channelId,
  mode = "group",
  title,
  layout = "channel",
}: {
  channelId?: string;
  mode?: "group" | "direct";
  title?: string;
  /** inbox = full Chat UI SDK shell; channel = detail-only embed */
  layout?: "inbox" | "channel";
}) {
  const host = useRef<HTMLDivElement>(null);
  const providerRef = useRef<HTMLElement | null>(null);
  const hideBarCleanupRef = useRef<(() => void) | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceStartedAtRef = useRef(0);
  const voiceStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const session = useSession();
  const [status, setStatus] = useState<StatusLabel>(connectionStatus);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [channelLoading, setChannelLoading] = useState(Boolean(channelId));
  const [channelLoadingLabel, setChannelLoadingLabel] = useState("Loading conversation…");
  const [callBusy, setCallBusy] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sttEnabled, setSttEnabled] = useState(getSttAvailability().enabled);
  const heading = title?.trim() || (layout === "inbox" ? "Communications" : mode === "group" ? "Team channel" : "Direct message");
  const channelReady = Boolean(channelId) && !channelLoading && !error;
  const canPlaceCall = Boolean(channelReady && status === "Connected" && !callBusy && !recording);
  const canRecordVoice = Boolean(channelReady && status === "Connected" && !voiceBusy && !callBusy);

  async function placeCall(mediaType: CallMediaKind) {
    if (!channelId || !session.data) {
      return;
    }
    setCallBusy(true);
    setCallError(null);
    try {
      const selfId = session.data.user.nexconnUserId;
      if (mode === "direct") {
        await startNexconnCall({
          calleeIds: [channelId],
          mediaType,
          callType: "single",
          peerNames: title ? { [channelId]: title } : undefined,
        });
      } else {
        const calleeIds = await resolveGroupCalleeIds(channelId, selfId);
        await startNexconnCall({
          calleeIds,
          mediaType,
          callType: "multi",
          targetId: channelId,
        });
      }
    } catch (cause) {
      setCallError(cause instanceof Error ? cause.message : "Could not start call");
    } finally {
      setCallBusy(false);
    }
  }

  async function toggleVoiceNote() {
    if (!channelId) {
      return;
    }
    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      return;
    }

    setCallError(null);
    setVoiceBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      voiceChunksRef.current = [];
      voiceStartedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (voiceStopTimerRef.current) {
          clearTimeout(voiceStopTimerRef.current);
          voiceStopTimerRef.current = null;
        }
        setRecording(false);
        mediaRecorderRef.current = null;

        void (async () => {
          try {
            const elapsedMs = Date.now() - voiceStartedAtRef.current;
            if (elapsedMs < 1_000) {
              setCallError("Record at least 1 second before sending a voice note.");
              return;
            }
            if (voiceChunksRef.current.length === 0) {
              setCallError("No audio was captured. Check the microphone and try again.");
              return;
            }
            const type = recorder.mimeType || mimeType || "audio/webm";
            const blob = new Blob(voiceChunksRef.current, { type });
            if (blob.size < 256) {
              setCallError("Voice note was too short or empty.");
              return;
            }
            // Convert to 16 kHz mono WAV — ChatUI's HTMLAudioElement player rejects many webm/opus URLs
            // ("Failed to load because no supported source was found").
            const file = await toNexconnHdVoiceFile(blob);
            // Must use ChatUI sendMessage so the bubble appears in the open channel.
            await sendChatVoice({
              channelId,
              file,
              mode,
              app: bootedApp,
              requestStt: getSttAvailability().enabled,
            });
          } catch (cause) {
            setCallError(cause instanceof Error ? cause.message : "Could not send voice note");
          } finally {
            setVoiceBusy(false);
          }
        })();
      };

      mediaRecorderRef.current = recorder;
      // Timeslice so browsers emit chunks before stop (avoids empty blobs).
      recorder.start(250);
      setRecording(true);
      setVoiceBusy(false);
      voiceStopTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current === recorder && recorder.state === "recording") {
          recorder.stop();
        }
      }, 60_000);
    } catch (cause) {
      setVoiceBusy(false);
      setCallError(
        cause instanceof Error
          ? cause.message
          : "Microphone permission is required to record a voice note.",
      );
    }
  }

  useEffect(() => {
    const onStatus = (next: StatusLabel) => setStatus(next);
    statusListeners.add(onStatus);
    setStatus(connectionStatus);
    return () => {
      statusListeners.delete(onStatus);
    };
  }, []);

  useEffect(() => subscribeSttAvailability((next) => setSttEnabled(next.enabled)), []);

  useEffect(() => {
    return () => {
      if (voiceStopTimerRef.current) {
        clearTimeout(voiceStopTimerRef.current);
      }
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!session.data || !host.current) {
      return;
    }

    void (async () => {
      try {
        setError(null);
        if (channelId) {
          setChannelLoading(true);
          setChannelLoadingLabel("Connecting…");
        } else {
          setChannelLoading(false);
          setChannelLoadingLabel("Loading conversation…");
        }
        if (connectionStatus !== "Connected") {
          setStatus("Connecting");
        }

        let app: ChatApp;
        if (bootPromise && bootedUserId === session.data!.user.id) {
          app = await bootPromise;
        } else if (bootedApp && bootedUserId === session.data!.user.id) {
          app = bootedApp;
          await ensureEngineConnected(await import("@nexconn/chat"));
        } else {
          const token = await fetchToken();
          app = await bootChat(token, session.data!.user.id);
        }
        if (cancelled || !host.current) {
          return;
        }

        // Mount Chat UI SDK custom elements only after ready() registers them.
        providerRef.current = mountChatUiHost(host.current, layout);
        setMounted(true);
        if (layout === "channel") {
          hideBarCleanupRef.current?.();
          hideBarCleanupRef.current = hideChatUiChannelDetailBar(host.current);
        }

        if (layout === "inbox") {
          app.setChannelBarTitle("Inbox");
          app.setChannelBarSwitch(true);
        } else {
          app.setChannelBarSwitch(false);
        }

        if (channelId) {
          setChannelLoadingLabel("Opening conversation…");
          await openChannelReliable(app, channelId, mode, {
            isCancelled: () => cancelled,
            onWait: (phase) => {
              if (cancelled) return;
              setChannelLoading(true);
              setChannelLoadingLabel(
                phase === "syncing"
                  ? "Syncing conversations…"
                  : "Reconnecting…",
              );
            },
          });
          if (!cancelled) {
            // Display-only: fill name/member count after open (esp. force-ready synthetic rows).
            await hydrateOpenedChannelProfile(app, channelId, mode, title);
            // Channel select may remount the detail bar inside shadow DOM — hide again.
            if (layout === "channel" && host.current) {
              hideBarCleanupRef.current?.();
              hideBarCleanupRef.current = hideChatUiChannelDetailBar(host.current);
            }
          }
        }

        if (!cancelled) {
          // Channel open must not invent a "Connected" status; trust the engine handler.
          const chat = await import("@nexconn/chat");
          if (chat.NCEngine.getConnectionStatus() === chat.ConnectionStatus.CONNECTED) {
            publishStatus("Connected");
            setStatus("Connected");
          }
          setError(null);
          setChannelLoading(false);
        }
      } catch (cause) {
        if (cancelled) {
          return;
        }
        const message = cause instanceof Error ? cause.message : "Nexconn is unavailable";
        const membershipFailure = MEMBERSHIP_ERROR_RE.test(message) || /fail:\s*22406/i.test(message);
        const authFailure = /auth|token|not configured|app key/i.test(message);
        if (authFailure) {
          publishStatus("Authentication required");
          setStatus("Authentication required");
        } else {
          // Keep showing real engine status — channel errors must not flap the connection badge.
          setStatus(connectionStatus);
        }
        setChannelLoading(false);
        setError(
          membershipFailure
            ? `${message}. If this is a team channel, add this user under Teams → Manage members, then reopen the chat.`
            : message,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [channelId, mode, layout, session.data?.user.id]);

  useEffect(() => {
    return () => {
      hideBarCleanupRef.current?.();
      hideBarCleanupRef.current = null;
      providerRef.current?.remove();
      providerRef.current = null;
    };
  }, []);

  // Display-only refresh when the parent title arrives/changes — does not reconnect or reopen.
  useEffect(() => {
    if (!channelId || !mounted || channelLoading || error) {
      return;
    }
    const app = bootedApp;
    if (!app?.ifReady()) {
      return;
    }
    void hydrateOpenedChannelProfile(app, channelId, mode, title);
  }, [channelId, mode, title, mounted, channelLoading, error]);

  return (
    <Card size="2" variant="surface" style={{ height: "100%", minHeight: 480, overflow: "hidden" }}>
      <Flex direction="column" height="100%" style={{ minHeight: 480 }}>
        <Flex
          align="center"
          justify="between"
          gap="3"
          px="3"
          py="2"
          style={{ borderBottom: "1px solid var(--gray-a5)", flexShrink: 0 }}
        >
          <Text size="2" weight="medium" highContrast>
            {heading}
          </Text>
          <Flex align="center" gap="2">
            {channelId ? (
              <>
                <Tooltip
                  content={
                    recording
                      ? "Stop and send voice note"
                      : sttEnabled
                        ? "Record voice note (right-click message → Transcribe)"
                        : "Record voice note"
                  }
                >
                  <IconButton
                    size="1"
                    variant="soft"
                    color={recording ? "red" : "gray"}
                    disabled={!canRecordVoice && !recording}
                    onClick={() => void toggleVoiceNote()}
                    aria-label={recording ? "Stop voice note" : "Record voice note"}
                  >
                    {recording ? <Square size={14} /> : <Mic size={14} />}
                  </IconButton>
                </Tooltip>
                <Tooltip content={mode === "direct" ? "Audio call" : "Group audio call"}>
                  <IconButton
                    size="1"
                    variant="soft"
                    color="gray"
                    disabled={!canPlaceCall}
                    onClick={() => void placeCall("audio")}
                    aria-label="Start audio call"
                  >
                    <Phone size={14} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={mode === "direct" ? "Video call" : "Group video call"}>
                  <IconButton
                    size="1"
                    variant="soft"
                    color="gray"
                    disabled={!canPlaceCall}
                    onClick={() => void placeCall("video")}
                    aria-label="Start video call"
                  >
                    <Video size={14} />
                  </IconButton>
                </Tooltip>
              </>
            ) : null}
            {sttEnabled ? (
              <Badge color="indigo" variant="soft" size="1">
                STT
              </Badge>
            ) : null}
            <Badge color={statusBadgeColor(status)} variant="soft" size="1">
              {status}
            </Badge>
          </Flex>
        </Flex>
        {error || callError ? (
          <Box px="3" py="2">
            <Callout.Root color="red" size="1">
              <Callout.Text>{error || callError}</Callout.Text>
            </Callout.Root>
          </Box>
        ) : null}
        {channelLoading && !error ? (
          <Box px="3" py="3">
            <LoadingBlock label={channelLoadingLabel} />
          </Box>
        ) : null}
        {!mounted && !error && !channelLoading ? (
          <Box px="3" py="2">
            <Text size="2" color="gray">
              Loading Nexconn Chat UI…
            </Text>
          </Box>
        ) : null}
        <Box
          ref={host}
          className={layout === "channel" ? "nexconn-host nexconn-host--channel" : "nexconn-host"}
          style={{
            minHeight: 0,
            flex: 1,
            // Keep the ChatUI host mounted while syncing so messages appear as soon as open succeeds.
            opacity: channelLoading && !error ? 0.35 : 1,
            pointerEvents: channelLoading && !error ? "none" : "auto",
          }}
        />
      </Flex>
    </Card>
  );
}
