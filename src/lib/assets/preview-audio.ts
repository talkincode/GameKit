/**
 * What the library player should load.
 *
 * Chrome and Firefox play Kenney's original OGG Vorbis. Safari does not.
 * Each OGG ships a sibling PCM WAV (`jump.ogg` → `jump.preview.wav`) that is
 * only a preview: copying into a project still uses the OGG listed in the manifest.
 */

const OGG_VORBIS = 'audio/ogg; codecs="vorbis"';

export function oggPreviewWavPath(assetPath: string): string | null {
  if (!assetPath.endsWith(".ogg")) return null;
  return `${assetPath.slice(0, -4)}.preview.wav`;
}

export function supportsOggVorbis(canPlayType: (mime: string) => string): boolean {
  const result = canPlayType(OGG_VORBIS);
  return result === "probably" || result === "maybe";
}

export type AudioPreviewPlan = {
  src: string;
  usingFallback: boolean;
  /** The browser cannot play this sound, and there is no WAV preview. */
  blocked: boolean;
};

export function planLibraryAudio(input: {
  mediaType: string;
  sourceUrl: string;
  fallbackUrl: string | null;
  canPlayOgg: boolean;
}): AudioPreviewPlan {
  if (!input.sourceUrl) return { src: "", usingFallback: false, blocked: false };
  const ogg = input.mediaType === "audio/ogg";
  if (ogg && !input.canPlayOgg) {
    if (input.fallbackUrl) return { src: input.fallbackUrl, usingFallback: true, blocked: false };
    return { src: "", usingFallback: false, blocked: true };
  }
  return { src: input.sourceUrl, usingFallback: false, blocked: false };
}

/**
 * Kid-facing length. Native controls draw sub-second sounds as 0:00 / 0:00,
 * which looks like the file never loaded. Tenths of a second stay visible.
 */
export function formatHeardLength(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) {
    const tenths = Math.max(1, Math.round(seconds * 10));
    return `${(tenths / 10).toFixed(1)} 秒`;
  }
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}
