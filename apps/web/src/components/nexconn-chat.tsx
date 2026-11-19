"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Box, Callout, Card, Flex, IconButton, Text, Tooltip } from "@radix-ui/themes";
import { Phone, Video } from "lucide-react";
import { api } from "@/lib/api";
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
const MAX_CONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_MS = 1500;

let bootPromise: Promise<ChatApp> | null = null;
let bootedApp: ChatApp | null = null;
let bootedUserId: string | null = null;
let pendingUserId: string | null = null;
let lastToken: TokenResponse | null = null;
let connectionStatus: StatusLabel = "Disconnected";
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let statusHandlerInstalled = false;
let destroying = false;
const statusListeners = new Set<(status: StatusLabel) => void>();

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

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
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
  options: { force?: boolean } = {},
): Promise<void> {
  const status = chat.NCEngine.getConnectionStatus();
  if (!options.force && status === chat.ConnectionStatus.CONNECTED) {
    reconnectAttempt = 0;
    publishStatus("Connected");
    return;
  }
  if (!options.force && status === chat.ConnectionStatus.CONNECTING) {
    publishStatus("Connecting");
    await waitForConnected(chat, 12_000);
    return;
  }

  if (
    options.force &&
    (status === chat.ConnectionStatus.CONNECTED || status === chat.ConnectionStatus.CONNECTING)
  ) {
    try {
      await chat.NCEngine.disconnect();
    } catch {
      // Best-effort before a forced reconnect.
    }
  }

  const token = lastToken ?? (await fetchToken());
  publishStatus(reconnectAttempt > 0 || options.force ? "Reconnecting" : "Connecting");
  let connected = await chat.NCEngine.connect({ token: token.token });
  if (!connected.isOk) {
    const fresh = await fetchToken();
    connected = await chat.NCEngine.connect({ token: fresh.token });
  }
  if (!connected.isOk) {
    throw new Error(connected.msg || "Nexconn connection failed");
  }
  reconnectAttempt = 0;
  publishStatus("Connected");
}

function waitForConnected(chat: typeof import("@nexconn/chat"), timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const status = chat.NCEngine.getConnectionStatus();
      if (status === chat.ConnectionStatus.CONNECTED) {
        reconnectAttempt = 0;
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

function scheduleReconnect(userId: string) {
  if (
    destroying ||
    (pendingUserId !== userId && bootedUserId !== userId)
  ) {
    return;
  }
  clearReconnectTimer();
  reconnectAttempt += 1;
  if (reconnectAttempt > MAX_CONNECT_ATTEMPTS) {
    publishStatus("Authentication required");
    return;
  }
  publishStatus("Reconnecting");
  const delay = RECONNECT_BASE_MS * 2 ** (reconnectAttempt - 1);
  reconnectTimer = setTimeout(() => {
    void (async () => {
      try {
        const token = await fetchToken();
        await bootChat(token, userId, { forceReconnect: true });
      } catch {
        scheduleReconnect(userId);
      }
    })();
  }, delay);
}

async function installStatusHandler(chat: typeof import("@nexconn/chat"), userId: string) {
  if (statusHandlerInstalled) {
    return;
  }
  const handler = new chat.ConnectionStatusHandler({
    onConnectionStatusChanged(event) {
      if (destroying) {
        return;
      }
      if (event.status === chat.ConnectionStatus.CONNECTED) {
        clearReconnectTimer();
        reconnectAttempt = 0;
        publishStatus("Connected");
        return;
      }
      if (event.status === chat.ConnectionStatus.CONNECTING) {
        publishStatus(reconnectAttempt > 0 ? "Reconnecting" : "Connecting");
        return;
      }
      if (event.status === chat.ConnectionStatus.SUSPENDED) {
        publishStatus("Reconnecting");
        return;
      }
      if (event.status === chat.ConnectionStatus.DISCONNECTED) {
        publishStatus("Disconnected");
        scheduleReconnect(userId);
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
  clearReconnectTimer();
  const app = bootedApp;
  const chatModule = await import("@nexconn/chat").catch(() => null);
  bootPromise = null;
  bootedApp = null;
  bootedUserId = null;
  pendingUserId = null;
  lastToken = null;
  reconnectAttempt = 0;
  publishStatus("Disconnected");
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
    publishStatus("Connecting");
    void (async () => {
      try {
        const token = await fetchToken();
        if (cancelled) {
          return;
        }
        await bootChat(token, userId);
        if (!cancelled) {
          publishStatus("Connected");
        }
      } catch {
        if (!cancelled) {
          scheduleReconnect(userId);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.data?.user.id]);
  return null;
}

async function bootChat(
  session: TokenResponse,
  userId: string,
  options: { forceReconnect?: boolean } = {},
): Promise<ChatApp> {
  if (
    !options.forceReconnect &&
    bootPromise &&
    (bootedUserId === userId || pendingUserId === userId)
  ) {
    return bootPromise;
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
    // Call SDK must install its Chat bridge before NCEngine.initialize.
    await installNexconnCallBridge();
    const chat = await import("@nexconn/chat");
    const ui = await import("@nexconn/chatui");
    const area = chat.AreaCode[session.areaCode as keyof typeof chat.AreaCode] ?? chat.AreaCode.SG;

    // Order required by Chat UI + Call: install Call → NCEngine → NCCallEngine → ChatUI → ready → connect.
    chat.NCEngine.initialize({
      appKey: session.appKey,
      areaCode: area,
      logLevel: chat.LogLevel.WARN,
    });
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

    await ensureEngineConnected(chat, { force: Boolean(options.forceReconnect) });
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
  userId: string,
): Promise<void> {
  const chat = await import("@nexconn/chat");
  await ensureEngineConnected(chat);
  if (!app.ifReady()) {
    app.ready();
  }
  const identifier =
    mode === "group" ? new chat.GroupChannelIdentifier(channelId) : new chat.DirectChannelIdentifier(channelId);

  let opened = await app.openChannel(identifier, true);
  if (opened && typeof opened.code === "number" && opened.code !== 0) {
    const token = await fetchToken();
    await bootChat(token, userId, { forceReconnect: true });
    await ensureEngineConnected(chat, { force: true });
    opened = await app.openChannel(identifier, true);
    if (opened && typeof opened.code === "number" && opened.code !== 0) {
      throw new Error(opened.msg || `Could not open channel (${opened.code})`);
    }
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
  const session = useSession();
  const [status, setStatus] = useState<StatusLabel>(connectionStatus);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [callBusy, setCallBusy] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const heading = title?.trim() || (layout === "inbox" ? "Communications" : mode === "group" ? "Team channel" : "Direct message");
  const canPlaceCall = Boolean(channelId && status === "Connected" && !callBusy);

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

  useEffect(() => {
    const onStatus = (next: StatusLabel) => setStatus(next);
    statusListeners.add(onStatus);
    setStatus(connectionStatus);
    return () => {
      statusListeners.delete(onStatus);
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

        if (layout === "inbox") {
          app.setChannelBarTitle("Inbox");
          app.setChannelBarSwitch(true);
        } else {
          app.setChannelBarSwitch(false);
        }

        if (channelId) {
          await openChannelReliable(app, channelId, mode, session.data!.user.id);
        }

        if (!cancelled) {
          publishStatus("Connected");
          setStatus("Connected");
          setError(null);
        }
      } catch (cause) {
        if (cancelled) {
          return;
        }
        const message = cause instanceof Error ? cause.message : "Nexconn is unavailable";
        const authFailure = /auth|token|not configured|app key/i.test(message);
        if (authFailure) {
          publishStatus("Authentication required");
          setStatus("Authentication required");
        } else if (connectionStatus === "Connected") {
          setStatus("Connected");
        } else {
          setStatus("Disconnected");
        }
        setError(
          /39005|not in group|not a member|permission/i.test(message)
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
      providerRef.current?.remove();
      providerRef.current = null;
    };
  }, []);

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
        {!mounted && !error ? (
          <Box px="3" py="2">
            <Text size="2" color="gray">
              Loading Nexconn Chat UI…
            </Text>
          </Box>
        ) : null}
        <Box ref={host} className="nexconn-host" style={{ minHeight: 0, flex: 1 }} />
      </Flex>
    </Card>
  );
}
