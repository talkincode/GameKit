import { describe, expect, it } from "vitest";
import { renderMusic, renderSfx, SAMPLE_RATE } from "./render";
import { readMusic, readSfx, readSoundSpec } from "./spec";
import { pcmToWav } from "./wav";

const patch = (raw: Record<string, unknown>) => readSfx(raw, "jump");

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

describe("sound specs", () => {
  it("clamps anything a model can get wrong", () => {
    const spec = patch({ layers: [{ wave: "laser", from: 99_999, to: -5, gain: 9, duration: 99 }] });
    expect(spec.layers[0].wave).toBe("triangle");
    expect(spec.layers[0].from).toBe(8000);
    expect(spec.layers[0].to).toBe(20);
    expect(spec.layers[0].gain).toBeLessThanOrEqual(0.6);
    expect(spec.layers[0].duration).toBeLessThanOrEqual(4);
  });

  it("keeps a usable patch when the model sends nothing sensible", () => {
    const spec = patch({});
    expect(spec.layers).toHaveLength(1);
    expect(spec.layers[0].duration).toBeGreaterThan(0);
    expect(spec.name).toBe("jump");
  });

  it("gives a name a file can use", () => {
    expect(patch({ name: "Jump Sound!" }).name).toBe("jumpsound");
    expect(patch({ name: "" }).name).toBe("jump");
  });

  it("reads a music answer into a few bars", () => {
    const music = readMusic({ bpm: 500, bars: 99, chords: [1, 4, 5, 99], tracks: [{ role: "bass" }] }, "space");
    expect(music.bpm).toBe(180);
    expect(music.bars).toBe(8);
    expect(music.chords.every((degree) => degree >= 1 && degree <= 7)).toBe(true);
    expect(music.tracks[0].role).toBe("bass");
    expect(music.tracks[0].octave).toBe(-1);
  });

  it("refuses an answer that is not JSON at all", () => {
    expect(() => readSoundSpec("sorry, no", "sfx", "jump")).toThrow(/JSON/);
  });
});

describe("rendering", () => {
  it("renders a patch to the length it asked for, loud but not clipping", () => {
    const pcm = renderSfx(patch({ layers: [{ duration: 0.2, gain: 0.5 }] }));
    expect(pcm.sampleRate).toBe(SAMPLE_RATE);
    expect(pcm.samples.length).toBe(Math.ceil(0.2 * SAMPLE_RATE));
    let peak = 0;
    for (const sample of pcm.samples) peak = Math.max(peak, Math.abs(sample));
    // Audible, and never clipping: the envelope may keep it below full gain.
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThanOrEqual(0.9 + 1e-6);
  });

  it("starts and ends quietly, so a sound does not click", () => {
    const pcm = renderSfx(patch({ layers: [{ duration: 0.3, attack: 0.02, release: 0.1 }] }));
    expect(Math.abs(pcm.samples[0])).toBeLessThan(0.05);
    expect(Math.abs(pcm.samples[pcm.samples.length - 1])).toBeLessThan(0.05);
  });

  it("is deterministic: the same patch gives the same samples", () => {
    const a = renderSfx(patch({ layers: [{ wave: "noise", duration: 0.1 }] }));
    const b = renderSfx(patch({ layers: [{ wave: "noise", duration: 0.1 }] }));
    expect(Array.from(a.samples.slice(0, 64))).toEqual(Array.from(b.samples.slice(0, 64)));
  });

  it("renders exactly the bars it was asked for, ready to loop", () => {
    const music = readMusic({ bpm: 120, bars: 2, chords: [1, 5], tracks: [{ role: "lead", gain: 0.3 }] }, "space");
    const pcm = renderMusic(music);
    // 2 bars of 4/4 at 120bpm = 4 seconds.
    expect(pcm.samples.length).toBe(4 * SAMPLE_RATE);
    expect(Math.abs(pcm.samples[pcm.samples.length - 1])).toBeLessThan(0.05);
  });
});

describe("wav encoding", () => {
  it("writes a header pygame can read", () => {
    const pcm = renderSfx(patch({ layers: [{ duration: 0.05 }] }));
    const wav = pcmToWav(pcm);
    const view = new DataView(wav.buffer);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16); // bits
    expect(wav.length).toBe(44 + pcm.samples.length * 2);
    expect(view.getUint32(4, true)).toBe(36 + pcm.samples.length * 2);
  });
});
