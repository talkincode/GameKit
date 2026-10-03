/**
 * 声音资产：LLM 出「音乐意图」，代码负责精确渲染。
 *
 * The model never writes samples. It picks a small, validated patch (an
 * oscillator envelope, or a few bars of notes), and src/lib/audio/render.ts turns
 * that into PCM the same way every time. Everything here is pure and testable.
 */
export type Wave = "sine" | "triangle" | "square" | "saw" | "noise";

const WAVES: Wave[] = ["sine", "triangle", "square", "saw", "noise"];
const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
};

export type SfxLayer = {
  wave: Wave;
  /** Start and end frequency in Hz; equal means a steady tone. */
  from: number;
  to: number;
  gain: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  duration: number;
  /** Optional one-pole low-pass to take the edge off. */
  cutoff?: number;
};

export type SfxSpec = { kind: "sfx"; say: string; name: string; layers: SfxLayer[] };

export type MusicTrack = {
  wave: Wave;
  gain: number;
  role: "lead" | "bass" | "hat";
  /** Shift in octaves from the root (
   * -1 = one octave down). */
  octave: number;
};

export type MusicSpec = {
  kind: "music";
  say: string;
  name: string;
  bpm: number;
  bars: number;
  root: number;
  scale: keyof typeof SCALES;
  /** Scale degrees (1-based) to walk through, one per bar. */
  chords: number[];
  tracks: MusicTrack[];
};

export type SoundSpec = SfxSpec | MusicSpec;

export function scaleNotes(scale: keyof typeof SCALES): number[] {
  return SCALES[scale] ?? SCALES.minor;
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, parsed));
}

function pickWave(value: unknown): Wave {
  return WAVES.includes(value as Wave) ? (value as Wave) : "triangle";
}

function pickName(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "") : "";
  return (text || fallback).slice(0, 24);
}

function pickSay(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

/** Reads an SFX patch, clamping everything into a range that cannot hurt ears. */
export function readSfx(raw: Record<string, unknown>, fallbackName = "sound"): SfxSpec {
  const layers = Array.isArray(raw.layers) ? raw.layers.slice(0, 4) : [];
  const cleaned: SfxLayer[] = [];
  for (const layer of layers) {
    if (!layer || typeof layer !== "object") continue;
    const entry = layer as Record<string, unknown>;
    cleaned.push({
      wave: pickWave(entry.wave),
      from: number(entry.from, 440, 20, 8000),
      to: number(entry.to, number(entry.from, 440, 20, 8000), 20, 8000),
      gain: number(entry.gain, 0.4, 0.02, 0.6),
      attack: number(entry.attack, 0.005, 0, 0.5),
      decay: number(entry.decay, 0.08, 0, 1),
      sustain: number(entry.sustain, 0.2, 0, 1),
      release: number(entry.release, 0.1, 0.01, 1),
      duration: number(entry.duration, 0.3, 0.02, 4),
      cutoff: entry.cutoff === undefined ? undefined : number(entry.cutoff, 3000, 200, 12_000),
    });
  }
  if (!cleaned.length) {
    cleaned.push({
      wave: "triangle",
      from: 660,
      to: 440,
      gain: 0.4,
      attack: 0.005,
      decay: 0.08,
      sustain: 0.2,
      release: 0.12,
      duration: 0.3,
    });
  }
  return { kind: "sfx", say: pickSay(raw.say), name: pickName(raw.name, fallbackName), layers: cleaned };
}

/** Reads a music score: a few bars, one chord per bar, three roles at most. */
export function readMusic(raw: Record<string, unknown>, fallbackName = "music"): MusicSpec {
  const scale = typeof raw.scale === "string" && raw.scale in SCALES ? (raw.scale as keyof typeof SCALES) : "minor";
  const degrees = scaleNotes(scale).length;
  const chords = (Array.isArray(raw.chords) ? raw.chords : [])
    .map((value) => Math.round(number(value, 1, 1, degrees)))
    .slice(0, 8);
  const tracks: MusicTrack[] = (Array.isArray(raw.tracks) ? raw.tracks : []).slice(0, 3).map((track) => {
    const entry = (track ?? {}) as Record<string, unknown>;
    const role: MusicTrack["role"] = entry.role === "bass" || entry.role === "hat" ? entry.role : "lead";
    return {
      wave: pickWave(entry.wave),
      gain: number(entry.gain, 0.25, 0.02, 0.5),
      role,
      octave: Math.round(number(entry.octave, role === "bass" ? -1 : 0, -2, 2)),
    };
  });
  return {
    kind: "music",
    say: pickSay(raw.say),
    name: pickName(raw.name, fallbackName),
    bpm: Math.round(number(raw.bpm, 100, 50, 180)),
    bars: Math.round(number(raw.bars, 4, 2, 8)),
    root: Math.round(number(raw.root, 57, 33, 81)),
    scale,
    chords: chords.length ? chords : [1, 4, 5, 6].slice(0, Math.round(number(raw.bars, 4, 2, 8))),
    tracks: tracks.length ? tracks : [{ wave: "triangle", gain: 0.25, role: "lead", octave: 0 }],
  };
}

/**
 * The one place that decides what a model answer is allowed to be. Throws when
 * there is nothing usable, so the round can fail cleanly instead of storing junk.
 */
export function readSoundSpec(raw: string, kind: "sfx" | "music", fallbackName: string): SoundSpec {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return JSON.");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object") throw new Error("The model returned nothing.");
  return kind === "sfx" ? readSfx(parsed, fallbackName) : readMusic(parsed, fallbackName);
}
