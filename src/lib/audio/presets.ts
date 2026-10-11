/**
 * Sounds a child can hear without logging in.
 *
 * Each preset is an ordinary spec the synthesizer already knows. Variants share
 * tags with the forest pictures (角色、金币、蘑菇、森林) so the library can show
 * them as one set. Nothing here calls a model.
 */
import { IDENTITY_EDIT, type SoundEdit } from "./edit";
import type { MusicSpec, SfxSpec } from "./spec";

export type SoundPreset = {
  id: string;
  title: string;
  kind: "sfx" | "music";
  tags: string[];
  /** Shares the forest picture pack's theme, so one filter shows both. */
  theme: string;
  spec: SfxSpec | MusicSpec;
  edit: SoundEdit;
};

const theme = "森林冒险";

function sfx(id: string, file: string, title: string, tags: string[], layer: SfxSpec["layers"][number]): SoundPreset {
  const spec: SfxSpec = { kind: "sfx", say: title, name: file, layers: [layer] };
  return { id, title, kind: "sfx", tags, theme, spec, edit: IDENTITY_EDIT };
}

export const SOUND_PRESETS: SoundPreset[] = [
  sfx("jump-sfx", "jump", "跳跃", ["音效", "跳跃", "角色"], {
    wave: "square",
    from: 520,
    to: 880,
    gain: 0.35,
    attack: 0.005,
    decay: 0.06,
    sustain: 0.15,
    release: 0.08,
    duration: 0.22,
  }),
  sfx("jump-soft", "jump-soft", "轻跳", ["音效", "跳跃", "角色", "变体"], {
    wave: "triangle",
    from: 440,
    to: 660,
    gain: 0.28,
    attack: 0.01,
    decay: 0.08,
    sustain: 0.2,
    release: 0.1,
    duration: 0.26,
  }),
  sfx("coin-sfx", "coin", "金币声", ["音效", "金币", "道具"], {
    wave: "square",
    from: 880,
    to: 1320,
    gain: 0.3,
    attack: 0.002,
    decay: 0.04,
    sustain: 0.1,
    release: 0.06,
    duration: 0.18,
  }),
  sfx("bump-sfx", "bump", "碰到蘑菇", ["音效", "撞击", "蘑菇"], {
    wave: "noise",
    from: 240,
    to: 90,
    gain: 0.4,
    attack: 0.001,
    decay: 0.05,
    sustain: 0.05,
    release: 0.08,
    duration: 0.16,
    cutoff: 1400,
  }),
  {
    id: "walk-music",
    title: "走路音乐",
    kind: "music",
    tags: ["音乐", "森林", "循环"],
    theme,
    edit: IDENTITY_EDIT,
    spec: {
      kind: "music",
      say: "一段可以循环的走路音乐。",
      name: "walk",
      bpm: 100,
      bars: 2,
      root: 57,
      scale: "minor",
      chords: [1, 4],
      tracks: [
        { wave: "triangle", gain: 0.22, role: "lead", octave: 0 },
        { wave: "triangle", gain: 0.18, role: "bass", octave: -1 },
        { wave: "noise", gain: 0.12, role: "hat", octave: 0 },
      ],
    },
  },
];

export function soundPreset(id: string): SoundPreset {
  return SOUND_PRESETS.find((preset) => preset.id === id) ?? SOUND_PRESETS[0];
}

export function presetsFor(kind: "sfx" | "music"): SoundPreset[] {
  return SOUND_PRESETS.filter((preset) => preset.kind === kind);
}
