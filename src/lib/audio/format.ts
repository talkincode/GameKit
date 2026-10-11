/**
 * Which audio files the browser runtime can play.
 *
 * pygame-web plays 8/16-bit PCM WAV (checked with a probe) and OGG Vorbis.
 * MP3, AIFF, Opus, and a WAV that is not PCM stay silent, so they are diagnosed
 * instead of being treated as a working game asset. See docs/runtime.md.
 */

export type AudioFormat = "wav" | "ogg" | "mp3" | "aiff" | "unknown";

export type AudioReason = "mp3" | "aiff" | "wav-bad" | "ogg-bad" | "unknown";

export type AudioVerdict = { ok: true; format: "wav" | "ogg" } | { ok: false; format: AudioFormat; reason: AudioReason };

const AUDIO_EXT = /\.(wav|ogg|mp3|aiff)$/i;

export function isAudioPath(path: string): boolean {
  return AUDIO_EXT.test(path);
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let text = "";
  const end = Math.min(bytes.length, at + length);
  for (let index = at; index < end; index += 1) text += String.fromCharCode(bytes[index]);
  return text;
}

function pcmWav(bytes: Uint8Array): boolean {
  if (bytes.length < 44) return false;
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let format = 0;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let dataBytes = -1;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (body + 16 > bytes.length) return false;
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      rate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      dataBytes = size;
      if (body + size > bytes.length) return false;
    }
    const step = 8 + size + (size % 2);
    if (step <= 0) return false;
    offset += step;
  }
  return format === 1 && channels >= 1 && channels <= 2 && (bits === 8 || bits === 16) && rate >= 8_000 && rate <= 48_000 && dataBytes >= 2;
}

/** OGG container plus a Vorbis identification packet. Opus in an Ogg page is not enough. */
function oggVorbis(bytes: Uint8Array): boolean {
  if (bytes.length < 64 || ascii(bytes, 0, 4) !== "OggS") return false;
  const head = ascii(bytes, 0, Math.min(bytes.length, 128));
  if (head.includes("OpusHead")) return false;
  return head.includes("vorbis");
}

/**
 * Null when the path is not audio. Otherwise a yes/no the diagnostics and the
 * asset-pack gate can both use.
 */
export function inspectAudio(path: string, bytes: Uint8Array | undefined): AudioVerdict | null {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext || !["wav", "ogg", "mp3", "aiff"].includes(ext)) return null;
  const data = bytes ?? new Uint8Array();
  if (ext === "mp3") return { ok: false, format: "mp3", reason: "mp3" };
  if (ext === "aiff") return { ok: false, format: "aiff", reason: "aiff" };
  if (ext === "wav") return pcmWav(data) ? { ok: true, format: "wav" } : { ok: false, format: "wav", reason: "wav-bad" };
  return oggVorbis(data) ? { ok: true, format: "ogg" } : { ok: false, format: "ogg", reason: "ogg-bad" };
}

/** What the Problems panel says. Short, and it names a format the runtime can play. */
export function audioProblemMessage(verdict: Extract<AudioVerdict, { ok: false }>): string {
  switch (verdict.reason) {
    case "mp3":
      return "浏览器里的 pygame 播不了 MP3。请换成 WAV，或 OGG Vorbis。";
    case "aiff":
      return "浏览器里的 pygame 播不了 AIFF。请换成 WAV，或 OGG Vorbis。";
    case "wav-bad":
      return "这个 WAV 不是浏览器能播的 PCM（8 位或 16 位）。可以用声音编辑器重新存一份。";
    case "ogg-bad":
      return "这个 OGG 没通过 Vorbis 检查。浏览器播的是 OGG Vorbis，不是 Opus。";
    default:
      return "这种音频在浏览器里播不了。请换成 WAV，或 OGG Vorbis。";
  }
}
