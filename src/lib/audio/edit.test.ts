import { describe, expect, it } from "vitest";
import { IDENTITY_EDIT, applyEdit, musicVoices, renderEdited, waveformPeaks } from "./edit";
import { inspectAudio } from "./format";
import { pygameSoundDemo, pygameSoundSnippet } from "./play";
import { SOUND_PRESETS, soundPreset } from "./presets";
import { renderMusic, renderSfx } from "./render";
import { readMusic, readSfx } from "./spec";
import { planSoundSave } from "./save";
import { pcmToWav } from "./wav";
import type { Project } from "../project";

function project(files: Project["files"] = []): Project {
  return { id: "p", name: "game", createdAt: 0, updatedAt: 0, files };
}

describe("edited sound", () => {
  it("previews and saves the same bytes as the synthesizer when nothing is trimmed", () => {
    const spec = readSfx({ layers: [{ wave: "square", from: 440, to: 880, duration: 0.2, gain: 0.4 }] }, "jump");
    const edited = renderEdited(spec, IDENTITY_EDIT);
    const raw = pcmToWav(renderSfx(spec));
    expect(Array.from(edited.wav)).toEqual(Array.from(raw));
    expect(inspectAudio("assets/jump.wav", edited.wav)).toEqual({ ok: true, format: "wav" });
  });

  it("makes a quieter, shorter file when volume and trim change", () => {
    const spec = readSfx({ layers: [{ duration: 0.4, gain: 0.5 }] }, "jump");
    const full = renderEdited(spec, IDENTITY_EDIT);
    const cut = renderEdited(spec, { volume: 0.5, trimStart: 0.05, trimEnd: 0.2, loop: false });
    expect(cut.pcm.samples.length).toBeLessThan(full.pcm.samples.length);
    let fullPeak = 0;
    let cutPeak = 0;
    for (const sample of full.pcm.samples) fullPeak = Math.max(fullPeak, Math.abs(sample));
    for (const sample of cut.pcm.samples) cutPeak = Math.max(cutPeak, Math.abs(sample));
    expect(cutPeak).toBeLessThan(fullPeak);
    expect(Array.from(renderEdited(spec, { volume: 0.5, trimStart: 0.05, trimEnd: 0.2, loop: false }).wav)).toEqual(Array.from(cut.wav));
  });

  it("changes the join when a loop fade is asked for, and keeps the length", () => {
    const spec = readSfx({ layers: [{ duration: 0.3, gain: 0.4 }] }, "jump");
    const plain = renderEdited(spec, IDENTITY_EDIT);
    const looped = renderEdited(spec, { ...IDENTITY_EDIT, loop: true });
    expect(looped.pcm.samples.length).toBe(plain.pcm.samples.length);
    expect(Array.from(looped.wav)).not.toEqual(Array.from(plain.wav));
  });

  it("draws a waveform and solos a music voice without changing the bar length", () => {
    const music = readMusic({ bpm: 120, bars: 2, chords: [1, 5], tracks: [{ role: "lead" }, { role: "bass" }, { role: "hat" }] }, "walk");
    const mix = renderEdited(music, IDENTITY_EDIT);
    const lead = renderEdited(musicVoices(music, ["lead"]), IDENTITY_EDIT);
    expect(mix.pcm.samples.length).toBe(4 * 22_050);
    expect(lead.pcm.samples.length).toBe(mix.pcm.samples.length);
    expect(Array.from(lead.wav)).not.toEqual(Array.from(pcmToWav(renderMusic(music))));
    expect(waveformPeaks(mix.pcm).length).toBe(80);
    expect(waveformPeaks(mix.pcm).some((peak) => peak > 0)).toBe(true);
  });

  it("refuses to save audio the browser cannot play", () => {
    const spec = soundPreset("jump-sfx");
    const wav = renderEdited(spec.spec, spec.edit).wav;
    const saved = planSoundSave(project([{ path: "main.py", text: "print(1)\n" }]), {
      bytes: wav,
      suggested: "assets/jump.wav",
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.path).toBe("assets/jump.wav");
      expect(saved.next.files.find((file) => file.path === "assets/jump.wav")?.bytes).toEqual(wav);
    }
    const bad = planSoundSave(project(), { bytes: new Uint8Array([1, 2, 3]), suggested: "assets/nope.wav" });
    expect(bad).toEqual({ ok: false, reason: "bad-audio" });
    const named = planSoundSave(project(), { bytes: wav, suggested: "../nope.wav" });
    expect(named).toEqual({ ok: false, reason: "name" });
  });

  it("writes a pygame example that loads the saved file and yields each frame", () => {
    const snippet = pygameSoundSnippet("assets/jump.wav", false);
    const demo = pygameSoundDemo("assets/library/forest-sounds/sounds/jump.wav", true);
    expect(snippet).toContain('pygame.mixer.Sound("assets/jump.wav")');
    expect(snippet).toContain("sound.play()");
    expect(demo).toContain("sound.play(-1)");
    expect(demo).toContain("await asyncio.sleep(0)");
    expect(demo).toContain("SOUND-OK");
    expect(demo).not.toContain("/asset-packs/");
    expect(demo).not.toContain("/api/");
  });
});

describe("sound presets", () => {
  it("shares tags with the forest pictures and renders a playable wav", () => {
    const jump = soundPreset("jump-sfx");
    const soft = soundPreset("jump-soft");
    expect(jump.tags).toEqual(expect.arrayContaining(["跳跃", "角色"]));
    expect(soft.tags).toContain("变体");
    expect(soft.tags).toEqual(expect.arrayContaining(["跳跃"]));
    expect(soundPreset("coin-sfx").tags).toContain("金币");
    expect(soundPreset("bump-sfx").tags).toContain("蘑菇");
    expect(soundPreset("walk-music").spec.kind).toBe("music");
    for (const preset of SOUND_PRESETS) {
      const wav = renderEdited(preset.spec, preset.edit).wav;
      expect(inspectAudio(`assets/${preset.spec.name}.wav`, wav)?.ok).toBe(true);
    }
  });

  it("does not change samples when the same preset is rendered twice", () => {
    const preset = soundPreset("coin-sfx");
    const a = renderEdited(preset.spec, preset.edit).wav;
    const b = applyEdit(
      { samples: renderEdited(preset.spec, IDENTITY_EDIT).pcm.samples, sampleRate: 22_050 },
      IDENTITY_EDIT,
    );
    expect(a.length).toBeGreaterThan(44);
    expect(b.samples.length).toBeGreaterThan(10);
  });
});
