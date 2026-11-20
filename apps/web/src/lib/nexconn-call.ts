"use client";

import { api } from "@/lib/api";
import { useUiStore } from "@/store/ui-store";

export type CallMediaKind = "audio" | "video";
export type CallKind = "single" | "multi";
export type CallPhase = "idle" | "incoming" | "outgoing" | "connected";

export interface CallSnapshot {
  phase: CallPhase;
  callId: string | null;
  mediaType: CallMediaKind;
  callType: CallKind;
  peerIds: string[];
  peerNames: Record<string, string>;
  callerUserId: string | null;
  error: string | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  ready: boolean;
}

type CallModule = typeof import("@nexconn/call");
type CallEngine = ReturnType<CallModule["NCCallEngine"]["initialize"]>;

const IDLE_SNAPSHOT: CallSnapshot = {
  phase: "idle",
  callId: null,
  mediaType: "audio",
  callType: "single",
  peerIds: [],
  peerNames: {},
  callerUserId: null,
  error: null,
  micEnabled: true,
  cameraEnabled: true,
  ready: false,
};

let callModule: CallModule | null = null;
let callEngine: CallEngine | null = null;
let installed = false;
let handlerWired = false;
let localVideoEl: HTMLVideoElement | null = null;
let remoteVideoHost: HTMLElement | null = null;
const remoteVideoEls = new Map<string, HTMLVideoElement>();
let selfNexconnUserId: string | null = null;
let snapshot: CallSnapshot = { ...IDLE_SNAPSHOT };
const listeners = new Set<(next: CallSnapshot) => void>();

function publish(partial: Partial<CallSnapshot> = {}) {
  snapshot = { ...snapshot, ...partial };
  listeners.forEach((listener) => listener(snapshot));
}

export function getCallSnapshot() {
  return snapshot;
}

export function subscribeCallSnapshot(listener: (next: CallSnapshot) => void) {
  listeners.add(listener);
  listener(snapshot);
  return () => {
    listeners.delete(listener);
  };
}

export function bindCallVideoElements(options: {
  local: HTMLVideoElement | null;
  remoteHost: HTMLElement | null;
}) {
  localVideoEl = options.local;
  remoteVideoHost = options.remoteHost;
  if (callEngine && localVideoEl) {
    try {
      callEngine.setLocalVideoView({ videoElement: localVideoEl });
    } catch {
      // Binding can fail before media devices are ready.
    }
  }
  if (snapshot.phase !== "idle" && snapshot.peerIds.length > 0) {
    syncRemoteVideoViews(snapshot.peerIds);
  }
}

function ensureRemoteVideoElement(userId: string): HTMLVideoElement | null {
  if (!remoteVideoHost) {
    return null;
  }
  const existing = remoteVideoEls.get(userId);
  if (existing && existing.isConnected) {
    return existing;
  }
  const video = document.createElement("video");
  // Do not set autoplay before a stream exists — empty media play() throws NotSupportedError.
  video.playsInline = true;
  video.muted = false;
  video.dataset.nexconnUserId = userId;
  video.style.width = "100%";
  video.style.height = "100%";
  video.style.objectFit = "cover";
  video.style.background = "#0f172a";
  video.style.borderRadius = "12px";
  video.addEventListener("error", () => undefined);
  remoteVideoHost.appendChild(video);
  remoteVideoEls.set(userId, video);
  return video;
}

function clearRemoteVideoElements() {
  for (const video of remoteVideoEls.values()) {
    video.remove();
  }
  remoteVideoEls.clear();
  if (remoteVideoHost) {
    remoteVideoHost.replaceChildren();
  }
}

function syncRemoteVideoViews(userIds: string[]) {
  if (!callEngine) {
    return;
  }
  const unique = [...new Set(userIds.filter((id) => id && id !== selfNexconnUserId))];
  for (const [userId, video] of [...remoteVideoEls.entries()]) {
    if (!unique.includes(userId)) {
      try {
        callEngine.removeVideoView([userId]);
      } catch {
        // ignore
      }
      video.remove();
      remoteVideoEls.delete(userId);
    }
  }
  const views = unique
    .map((userId) => {
      const videoElement = ensureRemoteVideoElement(userId);
      return videoElement ? { userId, videoElement } : null;
    })
    .filter((view): view is { userId: string; videoElement: HTMLVideoElement } => Boolean(view));
  if (views.length > 0) {
    try {
      callEngine.setRemoteVideoView(views);
      for (const view of views) {
        void view.videoElement.play().catch(() => undefined);
      }
    } catch {
      // ignore
    }
  }
}

async function resolvePeerNames(userIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) {
    return {};
  }
  try {
    const orgId = useUiStore.getState().organizationId;
    const profiles = await api<{ users: Array<{ userId: string; name: string }> }>("/nexconn/profiles", {
      method: "POST",
      body: { userIds: ids },
      orgId,
    });
    const names: Record<string, string> = {};
    for (const user of profiles.users ?? []) {
      names[user.userId] = user.name;
    }
    for (const id of ids) {
      if (!names[id]) names[id] = id;
    }
    return names;
  } catch {
    return Object.fromEntries(ids.map((id) => [id, id]));
  }
}

function mediaKindFromSdk(mediaType: number, call: CallModule): CallMediaKind {
  return mediaType === call.NCCallMediaType.AUDIO_VIDEO ? "video" : "audio";
}

function callKindFromSdk(callType: number, call: CallModule): CallKind {
  return callType === call.NCCallType.MULTI ? "multi" : "single";
}

function wireHandlers(engine: CallEngine, call: CallModule) {
  if (handlerWired) {
    return;
  }
  engine.setCallEventHandler({
    async onCallReceived(event) {
      const session = event.session;
      const callId = session.getCallId();
      const peers = session
        .getRemoteParticipants()
        .map((participant) => participant.userId)
        .filter(Boolean);
      const callerUserId = session.getCallerUserId() || peers[0] || null;
      const peerIds = peers.length > 0 ? peers : callerUserId ? [callerUserId] : [];
      const peerNames = await resolvePeerNames(peerIds);
      publish({
        phase: "incoming",
        callId,
        mediaType: mediaKindFromSdk(session.getMediaType(), call),
        callType: callKindFromSdk(session.getCallType(), call),
        peerIds,
        peerNames,
        callerUserId,
        error: null,
        micEnabled: true,
        cameraEnabled: session.getMediaType() === call.NCCallMediaType.AUDIO_VIDEO,
      });
      if (snapshot.mediaType === "video") {
        bindLocalPreview();
        syncRemoteVideoViews(peerIds);
      }
    },
    onCallConnected(event) {
      const session = event.session;
      const peers = session.getRemoteParticipants().map((participant) => participant.userId);
      publish({
        phase: "connected",
        callId: session.getCallId(),
        mediaType: mediaKindFromSdk(session.getMediaType(), call),
        callType: callKindFromSdk(session.getCallType(), call),
        peerIds: peers,
        error: null,
        micEnabled: engine.isMicrophoneEnabled(),
      });
      if (snapshot.mediaType === "video") {
        bindLocalPreview();
        syncRemoteVideoViews(peers);
      }
    },
    onCallEnded() {
      clearRemoteVideoElements();
      publish({ ...IDLE_SNAPSHOT, ready: true });
    },
    onRemoteUserStateChanged(event) {
      if (event.userState === call.NCCallUserState.ONCALL || event.userState === call.NCCallUserState.CONNECTING) {
        const peerIds = snapshot.peerIds.includes(event.userId)
          ? snapshot.peerIds
          : [...snapshot.peerIds, event.userId];
        publish({ peerIds });
        if (snapshot.mediaType === "video") {
          syncRemoteVideoViews(peerIds);
        }
      }
      if (
        event.userState === call.NCCallUserState.ENDED ||
        event.userState === call.NCCallUserState.DECLINED ||
        event.userState === call.NCCallUserState.NO_ANSWER ||
        event.userState === call.NCCallUserState.CANCELED
      ) {
        const peerIds = snapshot.peerIds.filter((id) => id !== event.userId);
        publish({ peerIds });
        if (snapshot.mediaType === "video") {
          syncRemoteVideoViews(peerIds);
        }
      }
    },
  });
  handlerWired = true;
}

function bindLocalPreview() {
  if (!callEngine || !localVideoEl) {
    return;
  }
  try {
    callEngine.setLocalVideoView({ videoElement: localVideoEl });
    void localVideoEl.play().catch(() => undefined);
  } catch {
    // ignore
  }
}

export async function ensureNexconnCallReady(nexconnUserId: string): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }
  selfNexconnUserId = nexconnUserId;
  try {
    if (!callModule) {
      callModule = await import("@nexconn/call");
    }
    if (!installed) {
      callModule.NCCallEngine.install();
      installed = true;
    }
    callEngine = callModule.NCCallEngine.initialize({
      logOutputLevel: callModule.NCCallLogLevel.WARN,
    });
    wireHandlers(callEngine, callModule);
    publish({ ready: true });
    return true;
  } catch (error) {
    publish({
      ready: false,
      error: error instanceof Error ? error.message : "Call SDK failed to initialize",
    });
    return false;
  }
}

/** Must run before NCEngine.initialize. Safe to call repeatedly. */
export async function installNexconnCallBridge(): Promise<void> {
  if (typeof window === "undefined" || installed) {
    return;
  }
  callModule = await import("@nexconn/call");
  callModule.NCCallEngine.install();
  installed = true;
}

export async function resetNexconnCall() {
  if (callEngine) {
    try {
      await callEngine.endCall();
    } catch {
      // Best-effort hangup on sign-out.
    }
  }
  clearRemoteVideoElements();
  handlerWired = false;
  callEngine = null;
  selfNexconnUserId = null;
  publish({ ...IDLE_SNAPSHOT });
}

function requireEngine(): { engine: CallEngine; call: CallModule } {
  if (!callEngine || !callModule) {
    throw new Error("Nexconn Call is not ready");
  }
  return { engine: callEngine, call: callModule };
}

export async function startNexconnCall(options: {
  calleeIds: string[];
  mediaType: CallMediaKind;
  callType?: CallKind;
  peerNames?: Record<string, string>;
  targetId?: string;
}) {
  const { engine, call } = requireEngine();
  const calleeIds = [...new Set(options.calleeIds.filter((id) => id && id !== selfNexconnUserId))];
  if (calleeIds.length === 0) {
    throw new Error("No participants available to call");
  }
  const callType = options.callType ?? (calleeIds.length > 1 ? "multi" : "single");
  const mediaType =
    options.mediaType === "video" ? call.NCCallMediaType.AUDIO_VIDEO : call.NCCallMediaType.AUDIO;
  const peerNames = options.peerNames ?? (await resolvePeerNames(calleeIds));

  publish({
    phase: "outgoing",
    callId: null,
    mediaType: options.mediaType,
    callType,
    peerIds: calleeIds,
    peerNames,
    callerUserId: selfNexconnUserId,
    error: null,
    micEnabled: true,
    cameraEnabled: options.mediaType === "video",
  });

  if (options.mediaType === "video") {
    bindLocalPreview();
    syncRemoteVideoViews(calleeIds);
  }

  const result = await engine.startCall({
    calleeIds,
    callType: callType === "multi" ? call.NCCallType.MULTI : call.NCCallType.SINGLE,
    mediaType,
    targetId: options.targetId,
  });

  if (result.code !== call.NCCallCode.SUCCESS) {
    clearRemoteVideoElements();
    publish({
      ...IDLE_SNAPSHOT,
      ready: true,
      error: `Could not start call (${result.code})`,
    });
    throw new Error(`Could not start call (${result.code})`);
  }

  publish({ callId: result.callId || null, phase: "outgoing" });
  return result.callId;
}

export async function acceptNexconnCall() {
  const { engine, call } = requireEngine();
  const callId = snapshot.callId;
  if (!callId) {
    throw new Error("No incoming call");
  }
  if (snapshot.mediaType === "video") {
    bindLocalPreview();
    syncRemoteVideoViews(snapshot.peerIds);
  }
  const result = await engine.acceptCall({ callId });
  if (result.code !== call.NCCallCode.SUCCESS) {
    throw new Error(`Could not accept call (${result.code})`);
  }
  publish({ phase: "connected", error: null });
}

export async function declineNexconnCall() {
  const { engine } = requireEngine();
  const callId = snapshot.callId ?? undefined;
  try {
    await engine.endCall(callId ? { callId } : undefined);
  } finally {
    clearRemoteVideoElements();
    publish({ ...IDLE_SNAPSHOT, ready: true });
  }
}

export async function hangupNexconnCall() {
  return declineNexconnCall();
}

export async function setNexconnMicEnabled(enabled: boolean) {
  const { engine, call } = requireEngine();
  const result = await engine.enableMicrophone(enabled);
  if (result.code !== call.NCCallCode.SUCCESS) {
    throw new Error(`Could not update microphone (${result.code})`);
  }
  publish({ micEnabled: enabled });
}

export async function setNexconnCameraEnabled(enabled: boolean) {
  const { engine, call } = requireEngine();
  const result = await engine.enableCamera(enabled);
  if (result.code !== call.NCCallCode.SUCCESS) {
    throw new Error(`Could not update camera (${result.code})`);
  }
  publish({ cameraEnabled: enabled });
}

export async function resolveGroupCalleeIds(groupId: string, selfId: string): Promise<string[]> {
  const orgId = useUiStore.getState().organizationId;
  const members = await api<Array<{ userId: string }>>("/nexconn/group-members", {
    method: "POST",
    body: { groupId },
    orgId,
  });
  return (members ?? [])
    .map((member) => member.userId)
    .filter((userId) => typeof userId === "string" && userId.length > 0 && userId !== selfId);
}
