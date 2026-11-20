"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Box, Button, Card, Flex, IconButton, Text } from "@radix-ui/themes";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import {
  acceptNexconnCall,
  bindCallVideoElements,
  declineNexconnCall,
  getCallSnapshot,
  hangupNexconnCall,
  setNexconnCameraEnabled,
  setNexconnMicEnabled,
  subscribeCallSnapshot,
  type CallSnapshot,
} from "@/lib/nexconn-call";

function peerLabel(snapshot: CallSnapshot) {
  const ids = snapshot.peerIds;
  if (ids.length === 0) {
    return "Unknown caller";
  }
  const names = ids.map((id) => snapshot.peerNames[id] || id);
  if (names.length === 1) {
    return names[0];
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  return `${names[0]} +${names.length - 1}`;
}

function phaseLabel(phase: CallSnapshot["phase"]) {
  if (phase === "incoming") return "Incoming call";
  if (phase === "outgoing") return "Calling…";
  if (phase === "connected") return "In call";
  return "";
}

export function NexconnCallOverlay() {
  const [snapshot, setSnapshot] = useState<CallSnapshot>(getCallSnapshot);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeCallSnapshot(setSnapshot), []);

  useEffect(() => {
    bindCallVideoElements({
      local: localRef.current,
      remoteHost: remoteHostRef.current,
    });
  }, [snapshot.phase, snapshot.mediaType]);

  // Never leave <video autoPlay> with an empty source — browsers throw NotSupportedError
  // ("Failed to load because no supported source was found") into the Next.js overlay.
  useEffect(() => {
    const local = localRef.current;
    if (!local) {
      return;
    }
    const onError = () => {
      // Swallow empty/unsupported source noise while idle or mid-setup.
    };
    local.addEventListener("error", onError);
    if (local.srcObject) {
      void local.play().catch(() => undefined);
    } else {
      local.removeAttribute("src");
      local.load();
    }
    return () => {
      local.removeEventListener("error", onError);
    };
  }, [snapshot.phase, snapshot.mediaType]);

  const showVideo = snapshot.mediaType === "video";
  const active = snapshot.phase !== "idle";

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Call action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      position="fixed"
      bottom="4"
      right="4"
      style={{
        zIndex: active ? 60 : -1,
        width: "min(360px, calc(100vw - 2rem))",
        opacity: active ? 1 : 0,
        pointerEvents: active ? "auto" : "none",
      }}
      aria-hidden={!active}
    >
      <Card size="2" variant="surface" style={{ boxShadow: active ? "var(--shadow-5)" : undefined }}>
        <Flex direction="column" gap="3">
          {active ? (
            <Flex align="center" justify="between" gap="2">
              <Box>
                <Text size="2" weight="medium" highContrast as="p">
                  {peerLabel(snapshot)}
                </Text>
                <Text size="1" color="gray">
                  {phaseLabel(snapshot.phase)} · {snapshot.mediaType === "video" ? "Video" : "Audio"}
                  {snapshot.callType === "multi" ? " · Group" : ""}
                </Text>
              </Box>
              <Badge color={snapshot.phase === "connected" ? "indigo" : "amber"} variant="soft">
                {snapshot.phase}
              </Badge>
            </Flex>
          ) : null}

          <Box
            style={{
              display: showVideo || !active ? "grid" : "none",
              gap: 8,
              gridTemplateColumns: "1fr 1fr",
              minHeight: showVideo ? 140 : 0,
            }}
          >
            <Box style={{ position: "relative", minHeight: showVideo ? 120 : 1 }}>
              <video
                ref={localRef}
                muted
                playsInline
                // autoPlay only after Call SDK binds srcObject — empty autoPlay throws NotSupportedError
                style={{
                  width: "100%",
                  height: "100%",
                  minHeight: showVideo ? 120 : 1,
                  objectFit: "cover",
                  borderRadius: 12,
                  background: "#0f172a",
                }}
              />
              {showVideo && active ? (
                <Text
                  size="1"
                  style={{
                    position: "absolute",
                    left: 8,
                    bottom: 8,
                    color: "white",
                    textShadow: "0 1px 2px rgba(0,0,0,.6)",
                  }}
                >
                  You
                </Text>
              ) : null}
            </Box>
            <Box
              ref={remoteHostRef}
              style={{ minHeight: showVideo ? 120 : 1, display: "grid", gap: 6 }}
            />
          </Box>

          {active && !showVideo ? (
            <Flex
              align="center"
              justify="center"
              style={{
                minHeight: 88,
                borderRadius: 12,
                background: "var(--gray-a3)",
              }}
            >
              <Phone size={28} />
            </Flex>
          ) : null}

          {active && (actionError || snapshot.error) ? (
            <Text size="1" color="red">
              {actionError || snapshot.error}
            </Text>
          ) : null}

          {active ? (
            <Flex gap="2" wrap="wrap" justify="end">
              {snapshot.phase === "incoming" ? (
                <>
                  <Button
                    color="red"
                    variant="soft"
                    disabled={busy}
                    onClick={() => void run(() => declineNexconnCall())}
                  >
                    <PhoneOff size={14} />
                    Decline
                  </Button>
                  <Button disabled={busy} onClick={() => void run(() => acceptNexconnCall())}>
                    <Phone size={14} />
                    Accept
                  </Button>
                </>
              ) : (
                <>
                  <IconButton
                    variant="soft"
                    color={snapshot.micEnabled ? "gray" : "red"}
                    disabled={busy}
                    onClick={() => void run(() => setNexconnMicEnabled(!snapshot.micEnabled))}
                    aria-label={snapshot.micEnabled ? "Mute microphone" : "Unmute microphone"}
                  >
                    {snapshot.micEnabled ? <Mic size={16} /> : <MicOff size={16} />}
                  </IconButton>
                  {showVideo ? (
                    <IconButton
                      variant="soft"
                      color={snapshot.cameraEnabled ? "gray" : "red"}
                      disabled={busy}
                      onClick={() =>
                        void run(() => setNexconnCameraEnabled(!snapshot.cameraEnabled))
                      }
                      aria-label={snapshot.cameraEnabled ? "Turn camera off" : "Turn camera on"}
                    >
                      {snapshot.cameraEnabled ? <Video size={16} /> : <VideoOff size={16} />}
                    </IconButton>
                  ) : null}
                  <Button color="red" disabled={busy} onClick={() => void run(() => hangupNexconnCall())}>
                    <PhoneOff size={14} />
                    Hang up
                  </Button>
                </>
              )}
            </Flex>
          ) : null}
        </Flex>
      </Card>
    </Box>
  );
}
