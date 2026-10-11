/**
 * Turns a validated patch into the exact samples the child hears and saves.
 *
 * Trim, volume, and an optional loop fade happen after the synthesizer, so the
 * preview player and the WAV in assets/ are one buffer. The same spec and edit
 * always produce the same bytes.
 */
import { envelopeAt, renderMusic, renderSfx, type Pcm } from "./render";
import type { MusicSpec, MusicTrack, SfxLayer, SfxSpec, SoundSpec } from "./spec";
import { pcmToWav } from "./wav";

export type SoundEdit = {
  /** 0 is silent, 1 leaves the synthesizer's level alone. */
  volume: number;
  /** Seconds from the start. */
  trimStart: number;
  /** Seconds. 0 means "through the end". */
  trimEnd: number;
  /** Fade the join so pygame's play(-1) does not click. */
  loop: boolean;
};

export const IDENTITY_EDIT: SoundEdit = { volume: 1, trimStart: 0, trimEnd: 0, loop: false };

const DEFAULT_VOICE: Record<MusicTrack["role"], MusicTrack> = {
  lead: { wave: "triangle", gain: 0.25, role: "lead", octave: 0 },
  bass: { wave: "triangle", gain: 0.2, role: "bass", octave: -1 },
  hat: { wave: "noise", gain: 0.15, role: "hat", octave: 0 },
};

export function soundFileStem(value: string, fallback: string): string {
  const text = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  return (text || fallback).slice(0, 24);
}

/** Keeps the requested voices, filling a missing role with a quiet default. */
export function musicVoices(spec: MusicSpec, roles: MusicTrack["role"][]): MusicSpec {
  const wanted = roles.filter((role, index) => roles.indexOf(role) === index);
  const picked = (wanted.length ? wanted : (["lead"] as const)).map(
    (role) => spec.tracks.find((track) => track.role === role) ?? DEFAULT_VOICE[role],
  );
  return { ...spec, tracks: picked };
}

export function clampEdit(edit: SoundEdit, duration: number): SoundEdit {
  const volume = Math.min(1, Math.max(0, Number.isFinite(edit.volume) ? edit.volume : 1));
  const full = Math.max(0.02, duration);
  const start = Math.min(Math.max(0, edit.trimStart), full - 0.02);
  const requestedEnd = edit.trimEnd <= 0 ? full : edit.trimEnd;
  const end = Math.min(full, Math.max(start + 0.02, requestedEnd));
  return { volume, trimStart: start, trimEnd: end, loop: edit.loop };
}

function fadeLoop(samples: Float32Array, sampleRate: number): void {
  const fade = Math.min(Math.floor(samples.length / 8), Math.floor(0.01 * sampleRate));
  if (fade < 2) return;
  const head = samples.slice(0, fade);
  for (let index = 0; index < fade; index += 1) {
    const blend = index / (fade - 1);
    const tailIndex = samples.length - fade + index;
    const tail = samples[tailIndex];
    samples[index] = head[index] * blend + tail * (1 - blend);
    samples[tailIndex] = tail * (1 - blend);
  }
}

/** Slice, scale, and optionally prepare a loop. Does not re-normalize, so volume is audible. */
export function applyEdit(pcm: Pcm, edit: SoundEdit): Pcm {
  const duration = pcm.samples.length / pcm.sampleRate;
  const clamped = clampEdit(edit, duration);
  const start = Math.floor(clamped.trimStart * pcm.sampleRate);
  const end = Math.min(pcm.samples.length, Math.ceil(clamped.trimEnd * pcm.sampleRate));
  const sliced = pcm.samples.slice(start, Math.max(start + 1, end));
  const samples = new Float32Array(sliced.length);
  for (let index = 0; index < sliced.length; index += 1) samples[index] = sliced[index] * clamped.volume;
  if (clamped.loop) fadeLoop(samples, pcm.sampleRate);
  return { samples, sampleRate: pcm.sampleRate };
}

export function renderEdited(spec: SoundSpec, edit: SoundEdit = IDENTITY_EDIT): { pcm: Pcm; wav: Uint8Array; seconds: number } {
  const raw = spec.kind === "sfx" ? renderSfx(spec) : renderMusic(spec);
  const pcm = applyEdit(raw, edit);
  return { pcm, wav: pcmToWav(pcm), seconds: pcm.samples.length / pcm.sampleRate };
}

/** The envelope drawn in the editor. Same curve the synthesizer applies. */
export function envelopeCurve(layer: SfxLayer, steps = 48): number[] {
  const points: number[] = [];
  const count = Math.max(2, steps);
  for (let index = 0; index < count; index += 1) {
    const time = (index / (count - 1)) * layer.duration;
    points.push(envelopeAt(layer, layer.duration, time));
  }
  return points;
}

/** Absolute peaks for the waveform, one number per column. */
export function waveformPeaks(pcm: Pcm, buckets = 80): number[] {
  const count = Math.max(1, buckets);
  const size = Math.max(1, Math.floor(pcm.samples.length / count));
  const peaks: number[] = [];
  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = bucket * size;
    const end = Math.min(pcm.samples.length, start + size);
    let peak = 0;
    for (let index = start; index < end; index += 1) peak = Math.max(peak, Math.abs(pcm.samples[index]));
    peaks.push(peak);
  }
  return peaks;
}

export type { SfxSpec };
