"use client";

/**
 * Nexconn built-in speech-to-text (STT).
 *
 * Chat SDK exposes `Message.requestSpeechToText()` and `NCEngine.getAppSettings().isSpeechToTextEnabled`.
 * ChatUI already wires Transcribe / Cancel Transcribe on HD voice messages when the console
 * voice-to-text service is enabled for the App Key (`getAppSettings().isSpeechToTextEnabled`).
 *
 * FieldOps only needs to: (1) detect STT after connect, (2) keep ChatUI message-menu STT items,
 * (3) send HD voice from Web so STT has something to transcribe (ChatUI Web cannot record voice).
 */

export type SttAvailability = {
  /** True after we have checked app settings post-connect. */
  checked: boolean;
  /** Console / server flag from NCEngine.getAppSettings(). */
  enabled: boolean;
};

const listeners = new Set<(next: SttAvailability) => void>();
let availability: SttAvailability = { checked: false, enabled: false };

function publish(next: SttAvailability) {
  availability = next;
  listeners.forEach((listener) => listener(availability));
}

export function getSttAvailability() {
  return availability;
}

export function subscribeSttAvailability(listener: (next: SttAvailability) => void) {
  listeners.add(listener);
  listener(availability);
  return () => {
    listeners.delete(listener);
  };
}

export function resetSttAvailability() {
  publish({ checked: false, enabled: false });
}

/** Call after a successful NCEngine.connect — STT flag is part of post-navi app settings. */
export async function refreshNexconnSttAvailability(
  chat: typeof import("@nexconn/chat"),
): Promise<SttAvailability> {
  try {
    const result = chat.NCEngine.getAppSettings();
    const enabled = Boolean(result.isOk && result.data?.isSpeechToTextEnabled);
    const next = { checked: true, enabled };
    publish(next);
    return next;
  } catch {
    const next = { checked: true, enabled: false };
    publish(next);
    return next;
  }
}

/**
 * Ensure built-in Transcribe / Cancel Transcribe menu entries exist before ChatUI ready().
 * ChatUI also gates visibility on `isSpeechToTextEnabled` at open-time.
 */
export function ensureChatUiSttMessageMenu(
  app: NonNullable<ReturnType<(typeof import("@nexconn/chatui"))["NCChatUIApplication"]["initialize"]>>,
  ui: typeof import("@nexconn/chatui"),
) {
  if (app.ifReady()) {
    return;
  }
  try {
    const menu = app.cloneMessageMenu();
    const ids = new Set(menu.map((item) => item.id));
    const placeholderIcon =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="%230f172a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
      );

    if (!ids.has(ui.MessageMenuID.SPEECH_TO_TEXT)) {
      menu.push({ id: ui.MessageMenuID.SPEECH_TO_TEXT, icon: placeholderIcon });
    }
    if (!ids.has(ui.MessageMenuID.CANCEL_SPEECH_TO_TEXT)) {
      menu.push({ id: ui.MessageMenuID.CANCEL_SPEECH_TO_TEXT, icon: placeholderIcon });
    }
    app.setMessageMenu(menu);
  } catch {
    // Pre-ready only; ignore if ChatUI already locked config.
  }
}
