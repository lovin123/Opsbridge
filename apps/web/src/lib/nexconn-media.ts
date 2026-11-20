/**
 * Chat media uses Nexconn Helper upload paths, not Cloudinary.
 * Prefer ChatUI `app.sendMessage` when available so the open channel list updates.
 */

import {
  registerNexconnVoicePlaybackAlias,
  rememberNexconnVoiceRemoteUrl,
} from "@/lib/nexconn-audio";

type ChatApp = NonNullable<ReturnType<(typeof import("@nexconn/chatui"))["NCChatUIApplication"]["initialize"]>>;

export async function sendChatImage(channelId: string, file: File, mode: "group" | "direct", app?: ChatApp | null) {
  const chat = await import("@nexconn/chat");
  const prepared = await chat.Helper.createSendImageMessageParams(file);
  if (!prepared.isOk || !prepared.data) {
    throw new Error(prepared.msg || "Could not prepare the image message");
  }
  return sendPreparedMedia({ chat, channelId, mode, params: prepared.data, app });
}

/**
 * Send an HD voice message (RC:HQVCMsg). Required for built-in STT.
 * Must go through ChatUI `app.sendMessage` so the bubble appears, and register a local
 * object-URL alias so ChatUI playback works even when the CDN URL is not natively playable.
 */
export async function sendChatVoice(options: {
  channelId: string;
  file: File;
  mode: "group" | "direct";
  app?: ChatApp | null;
  /** After a successful send, request Nexconn STT when console STT is enabled. */
  requestStt?: boolean;
}) {
  const chat = await import("@nexconn/chat");
  const prepared = await chat.Helper.createSendHDVoiceMessageParams(options.file);
  if (!prepared.isOk || !prepared.data) {
    throw new Error(prepared.msg || "Could not prepare the voice message");
  }

  // Help ChatUI / STT identify the payload as WAV.
  try {
    if (prepared.data.content && typeof prepared.data.content === "object") {
      (prepared.data.content as { format?: string }).format = "wav";
    }
  } catch {
    // ignore
  }

  const localObjectUrl = registerNexconnVoicePlaybackAlias({ file: options.file });

  prepared.data.onUploadComplete = (remoteUrl: string) => {
    rememberNexconnVoiceRemoteUrl(remoteUrl, localObjectUrl);
  };

  const message = await sendPreparedMedia({
    chat,
    channelId: options.channelId,
    mode: options.mode,
    params: prepared.data,
    app: options.app,
  });

  const remoteFromMessage =
    message && typeof message === "object" && message.content && typeof message.content === "object"
      ? String((message.content as { remoteUrl?: string }).remoteUrl || "")
      : "";
  if (remoteFromMessage) {
    rememberNexconnVoiceRemoteUrl(remoteFromMessage, localObjectUrl);
  }

  if (options.requestStt && message && typeof message.requestSpeechToText === "function") {
    try {
      const stt = await message.requestSpeechToText();
      if (!stt.isOk) {
        console.warn("[nexconn] requestSpeechToText failed", stt.code, stt.msg);
      }
    } catch (error) {
      console.warn("[nexconn] requestSpeechToText threw", error);
    }
  }

  return message;
}

async function sendPreparedMedia(options: {
  chat: typeof import("@nexconn/chat");
  channelId: string;
  mode: "group" | "direct";
  // Helper factories return Send*MessageParams subclasses accepted by ChatUI + Channel APIs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any;
  app?: ChatApp | null;
}) {
  const { chat, channelId, mode, params, app } = options;
  const identifier =
    mode === "group"
      ? new chat.GroupChannelIdentifier(channelId)
      : new chat.DirectChannelIdentifier(channelId);

  // ChatUI owns the visible message list — route sends through it when ready.
  if (app?.ifReady()) {
    const sent = await app.sendMessage(identifier, params);
    if (!sent.isOk || (typeof sent.code === "number" && sent.code !== 0)) {
      throw new Error(sent.msg || `Could not send media message (${sent.code ?? "?"})`);
    }
    return sent.data;
  }

  const channel =
    mode === "group" ? new chat.GroupChannel(channelId) : new chat.DirectChannel(channelId);
  const sent = await channel.sendMediaMessage(params);
  if (sent.code !== 0) {
    throw new Error(sent.msg || "Could not send the media message");
  }
  if (app?.ifReady() && sent.data) {
    try {
      await app.insertMessage(sent.data);
    } catch {
      // Best-effort UI sync if ChatUI became ready mid-send.
    }
  }
  return sent.data;
}
