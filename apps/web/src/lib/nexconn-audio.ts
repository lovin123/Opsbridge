/**
 * Convert MediaRecorder output to 16 kHz mono WAV for Nexconn HD voice, and
 * patch HTMLAudioElement playback so ChatUI voice bubbles don't throw
 * unhandled NotSupportedError when remote CDN/S3 URLs fail native decode.
 */

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function encodeWavMono16(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels === 1) {
    return buffer.getChannelData(0).slice();
  }
  const mixed = new Float32Array(length);
  for (let channel = 0; channel < numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      mixed[i] += data[i] / numberOfChannels;
    }
  }
  return mixed;
}

function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) {
    return input;
  }
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const frac = position - index;
    const a = input[index] ?? 0;
    const b = input[Math.min(index + 1, input.length - 1)] ?? 0;
    output[i] = a + (b - a) * frac;
  }
  return output;
}

/** Decode MediaRecorder output and return a 16 kHz mono WAV for HD voice + ChatUI playback. */
export async function toNexconnHdVoiceFile(blob: Blob, namePrefix = "voice"): Promise<File> {
  const targetRate = 16_000;
  const bytes = await blob.arrayBuffer();
  const context = new AudioContext({ sampleRate: targetRate });
  try {
    const decoded = await context.decodeAudioData(bytes.slice(0));
    const mono = mixToMono(decoded);
    const samples = resampleLinear(mono, decoded.sampleRate, targetRate);
    if (samples.length < targetRate * 0.4) {
      throw new Error("Record at least 1 second before sending a voice note.");
    }
    if (samples.length > targetRate * 60) {
      throw new Error("Voice notes must be 60 seconds or less.");
    }
    const wav = encodeWavMono16(samples, targetRate);
    return new File([wav], `${namePrefix}-${Date.now()}.wav`, { type: "audio/wav" });
  } catch (error) {
    if (error instanceof Error && /at least 1 second|60 seconds/i.test(error.message)) {
      throw error;
    }
    throw new Error(
      error instanceof Error
        ? `Could not process voice note: ${error.message}`
        : "Could not process voice note audio",
    );
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** remoteUrl (or filename) → local object URL for reliable same-session playback */
const localPlaybackByRemote = new Map<string, string>();
const localPlaybackByName = new Map<string, string>();
let playPatchInstalled = false;
let sharedAudioContext: AudioContext | null = null;

function guessAudioMime(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes(".wav")) return "audio/wav";
  if (lower.includes(".mp3")) return "audio/mpeg";
  if (lower.includes(".m4a") || lower.includes(".mp4") || lower.includes(".aac")) return "audio/mp4";
  if (lower.includes(".ogg")) return "audio/ogg";
  if (lower.includes(".webm")) return "audio/webm";
  return "audio/wav";
}

function basename(url: string): string {
  try {
    const path = new URL(url, window.location.href).pathname;
    return path.split("/").pop() || "";
  } catch {
    return url.split("?")[0]?.split("/").pop() || "";
  }
}

function resolveLocalAlias(src: string): string | null {
  if (!src) return null;
  if (localPlaybackByRemote.has(src)) return localPlaybackByRemote.get(src)!;
  const name = basename(src);
  if (name && localPlaybackByName.has(name)) return localPlaybackByName.get(name)!;
  return null;
}

async function playDecodedBuffer(src: string): Promise<void> {
  const res = await fetch(src, { mode: "cors", credentials: "omit" });
  if (!res.ok) {
    throw new Error(`audio fetch failed (${res.status})`);
  }
  const bytes = await res.arrayBuffer();
  sharedAudioContext ??= new AudioContext();
  if (sharedAudioContext.state === "suspended") {
    await sharedAudioContext.resume();
  }
  const buffer = await sharedAudioContext.decodeAudioData(bytes.slice(0));
  const source = sharedAudioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(sharedAudioContext.destination);
  source.start(0);
}

/**
 * Register a local object URL so ChatUI can play this voice note even when the
 * remote CDN/S3 URL is empty, blocked, or an unsupported container.
 */
export function registerNexconnVoicePlaybackAlias(options: {
  file: File;
  objectUrl?: string;
  remoteUrl?: string | null;
}) {
  const objectUrl = options.objectUrl ?? URL.createObjectURL(options.file);
  localPlaybackByName.set(options.file.name, objectUrl);
  if (options.remoteUrl) {
    localPlaybackByRemote.set(options.remoteUrl, objectUrl);
  }
  return objectUrl;
}

export function rememberNexconnVoiceRemoteUrl(remoteUrl: string, objectUrl: string) {
  if (remoteUrl && objectUrl) {
    localPlaybackByRemote.set(remoteUrl, objectUrl);
    const name = basename(remoteUrl);
    if (name) localPlaybackByName.set(name, objectUrl);
  }
}

/**
 * ChatUI calls `audio.play()` without `.catch()`. Empty/unsupported remoteUrl becomes an
 * unhandledRejection NotSupportedError in Next.js. Patch once per page.
 */
export function installNexconnAudioPlayPatch() {
  if (typeof window === "undefined" || playPatchInstalled) {
    return;
  }
  playPatchInstalled = true;

  const original = HTMLAudioElement.prototype.play;
  HTMLAudioElement.prototype.play = function patchedPlay(this: HTMLAudioElement, ...args: []) {
    const rawSrc = this.currentSrc || this.src || this.getAttribute("src") || "";
    if (!rawSrc || rawSrc === window.location.href) {
      // ChatUI sometimes calls play() before remoteUrl is set.
      return Promise.resolve();
    }

    const alias = resolveLocalAlias(rawSrc);
    if (alias && this.src !== alias) {
      this.src = alias;
    }

    return original.apply(this, args as []).catch(async (error: unknown) => {
      const name = error instanceof Error ? error.name : "";
      if (name !== "NotSupportedError" && name !== "AbortError") {
        throw error;
      }

      const src = this.currentSrc || this.src || rawSrc;
      const local = resolveLocalAlias(src);
      if (local) {
        this.src = local;
        try {
          return await original.apply(this, args as []);
        } catch {
          // fall through to decode path
        }
      }

      try {
        const res = await fetch(src, { mode: "cors", credentials: "omit" });
        if (!res.ok) {
          throw error;
        }
        const blob = await res.blob();
        const typed =
          blob.type && blob.type.startsWith("audio/")
            ? blob
            : new Blob([blob], { type: guessAudioMime(src) });
        const objectUrl = URL.createObjectURL(typed);
        rememberNexconnVoiceRemoteUrl(src, objectUrl);
        this.src = objectUrl;
        return await original.apply(this, args as []);
      } catch {
        try {
          await playDecodedBuffer(local || src);
          return;
        } catch {
          // Swallow — ChatUI already has an audio `error` listener for UI state.
          // Re-throwing only recreates the Next.js unhandledRejection overlay.
          return;
        }
      }
    });
  } as typeof HTMLAudioElement.prototype.play;
}
