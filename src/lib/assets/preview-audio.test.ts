import { describe, expect, it } from "vitest";
import { formatHeardLength, oggPreviewWavPath, planLibraryAudio, supportsOggVorbis } from "./preview-audio";

describe("library audio preview", () => {
  it("points an ogg file at a sibling wav preview", () => {
    expect(oggPreviewWavPath("sounds/jump.ogg")).toBe("sounds/jump.preview.wav");
    expect(oggPreviewWavPath("sounds/jump.wav")).toBeNull();
  });

  it("plays wav and ogg directly, and falls back when ogg is unsupported", () => {
    expect(
      planLibraryAudio({ mediaType: "audio/wav", sourceUrl: "/jump.wav", fallbackUrl: null, canPlayOgg: false }),
    ).toEqual({ src: "/jump.wav", usingFallback: false, blocked: false });
    expect(
      planLibraryAudio({
        mediaType: "audio/ogg",
        sourceUrl: "/boom.ogg",
        fallbackUrl: "/boom.preview.wav",
        canPlayOgg: true,
      }),
    ).toEqual({ src: "/boom.ogg", usingFallback: false, blocked: false });
    expect(
      planLibraryAudio({
        mediaType: "audio/ogg",
        sourceUrl: "/boom.ogg",
        fallbackUrl: "/boom.preview.wav",
        canPlayOgg: false,
      }),
    ).toEqual({ src: "/boom.preview.wav", usingFallback: true, blocked: false });
    expect(
      planLibraryAudio({ mediaType: "audio/ogg", sourceUrl: "/boom.ogg", fallbackUrl: null, canPlayOgg: false }),
    ).toEqual({ src: "", usingFallback: false, blocked: true });
  });

  it("treats a blank canPlayType as unsupported ogg", () => {
    expect(supportsOggVorbis(() => "")).toBe(false);
    expect(supportsOggVorbis(() => "probably")).toBe(true);
    expect(supportsOggVorbis(() => "maybe")).toBe(true);
  });

  it("does not draw a sub-second sound as zero", () => {
    expect(formatHeardLength(0)).toBeNull();
    expect(formatHeardLength(Number.NaN)).toBeNull();
    expect(formatHeardLength(0.22)).toBe("0.2 秒");
    expect(formatHeardLength(1.002)).toBe("1.0 秒");
    expect(formatHeardLength(65)).toBe("1:05");
  });
});
