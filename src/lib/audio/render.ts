/**
 * 把谱面/音色参数渲染成 PCM（确定性：同样的 spec 永远得到同样的样本）。
 *
 * A tiny synthesizer written out by hand rather than Web Audio: the same numbers
 * come out in every browser, tests can assert on the samples, and a game asset is
 * small enough that speed does not matter.
 *
 * 音效用单声道 22.05 kHz，一只脚踩在怀旧游戏声音上，一只脚在文件大小上。
 */
import { scaleNotes, type MusicSpec, type MusicTrack, type SfxSpec, type Wave } from "./spec";

export const SAMPLE_RATE = 22_050;

export type Pcm = { samples: Float32Array; sampleRate: number };

/** Deterministic noise: the same spec renders byte-identical audio. */
function noiseSource(): () => number {
  let seed = 0x2f6e2b1;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return (seed / 0xffffffff) * 2 - 1;
  };
}

function oscillator(wave: Wave, phase: number): number {
  const t = phase / (2 * Math.PI);
  const wrapped = t - Math.floor(t);
  switch (wave) {
    case "sine":
      return Math.sin(phase);
    case "triangle":
      return 4 * Math.abs(wrapped - 0.5) - 1;
    case "square":
      return wrapped < 0.5 ? 1 : -1;
    case "saw":
      return 2 * wrapped - 1;
    default:
      return 0;
  }
}

/** One-pole low-pass, the cheapest way to stop a square wave from sounding harsh. */
function lowpass(input: Float32Array, cutoff: number): Float32Array {
  const alpha = Math.min(1, (2 * Math.PI * cutoff) / SAMPLE_RATE);
  const out = new Float32Array(input.length);
  let last = 0;
  for (let index = 0; index < input.length; index += 1) {
    last += alpha * (input[index] - last);
    out[index] = last;
  }
  return out;
}

/** attack → decay → sustain → release，音量只往下降。 */
function envelope(layer: { attack: number; decay: number; sustain: number; release: number }, duration: number) {
  const attack = Math.min(layer.attack, duration);
  const decay = Math.min(layer.decay, Math.max(0, duration - attack));
  const release = Math.min(layer.release, 0.4);
  const plain = Math.max(0, duration - attack - decay - release);
  return (time: number): number => {
    if (time < attack) return attack > 0 ? time / attack : 1;
    if (time < attack + decay) {
      const at = decay > 0 ? (time - attack) / decay : 1;
      return 1 - (1 - layer.sustain) * at;
    }
    if (time < attack + decay + plain) return layer.sustain;
    const at = (time - attack - decay - plain) / Math.max(release, 0.001);
    return layer.sustain * Math.max(0, 1 - at);
  };
}

export function renderSfx(spec: SfxSpec): Pcm {
  const length = Math.max(1, Math.ceil(Math.max(...spec.layers.map((layer) => layer.duration)) * SAMPLE_RATE));
  const samples = new Float32Array(length);
  for (const layer of spec.layers) {
    const partial = new Float32Array(length);
    const noise = noiseSource();
    const shape = envelope(layer, layer.duration);
    let phase = 0;
    const end = Math.min(length, Math.ceil(layer.duration * SAMPLE_RATE));
    for (let index = 0; index < end; index += 1) {
      const time = index / SAMPLE_RATE;
      const progress = layer.duration > 0 ? time / layer.duration : 0;
      const frequency = layer.from + (layer.to - layer.from) * progress;
      phase += (2 * Math.PI * frequency) / SAMPLE_RATE;
      const value = layer.wave === "noise" ? noise() : oscillator(layer.wave, phase);
      partial[index] = value * shape(time) * layer.gain;
    }
    const shaped = layer.cutoff ? lowpass(partial, layer.cutoff) : partial;
    for (let index = 0; index < length; index += 1) samples[index] += shaped[index];
  }
  return { samples: normalize(samples), sampleRate: SAMPLE_RATE };
}

/** Keeps the loudest peak at 0.9 so nothing clips and nothing is inaudible. */
function normalize(samples: Float32Array): Float32Array {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak <= 0.9) return samples;
  const gain = 0.9 / peak;
  for (let index = 0; index < samples.length; index += 1) samples[index] *= gain;
  return samples;
}

/** MIDI note → Hz。 */
function frequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * 一圈就是一pattern：主旋律走和弦音，贝斯踩根音，嚓在每拍后半。
 * The loop is exactly `bars` bars long with nothing ringing past the end, so it
 * can repeat without a click.
 */
export function renderMusic(spec: MusicSpec): Pcm {
  const beat = 60 / spec.bpm;
  const beatsPerBar = 4;
  const length = Math.max(1, Math.round(spec.bars * beatsPerBar * beat * SAMPLE_RATE));
  const samples = new Float32Array(length);
  const scale = scaleNotes(spec.scale);

  const notesFor = (track: MusicTrack, degree: number): number[] => {
    const base = spec.root + scale[(degree - 1 + scale.length) % scale.length] + track.octave * 12;
    if (track.role === "bass") return [base - 12];
    if (track.role === "lead") return [base, base + scale[2], base + scale[4], base + scale[2]];
    return [];
  };

  for (const track of spec.tracks) {
    for (let bar = 0; bar < spec.bars; bar += 1) {
      const degree = spec.chords[bar % spec.chords.length] ?? 1;
      const notes = notesFor(track, degree);
      if (track.role === "hat") {
        const noise = noiseSource();
        const step = beat / 2;
        for (let time = 0; time < beatsPerBar * beat; time += step) {
          const start = Math.floor((bar * beatsPerBar * beat + time) * SAMPLE_RATE);
          const hatLength = Math.floor(0.05 * SAMPLE_RATE);
          for (let index = 0; index < hatLength && start + index < length; index += 1) {
            const decay = Math.exp((-6 * index) / hatLength);
            samples[start + index] += noise() * decay * track.gain * 0.6;
          }
        }
        continue;
      }
      const step = beat / 2;
      notes.forEach((midi, noteIndex) => {
        const start = Math.floor((bar * beatsPerBar * beat + noteIndex * step) * SAMPLE_RATE);
        const noteLength = Math.floor(step * 1.6 * SAMPLE_RATE);
        let phase = 0;
        for (let index = 0; index < noteLength && start + index < length; index += 1) {
          const progress = index / noteLength;
          const shape = Math.min(1, progress / 0.02) * Math.max(0, 1 - progress) ** 1.4;
          phase += (2 * Math.PI * frequency(midi)) / SAMPLE_RATE;
          samples[start + index] += oscillator(track.wave, phase) * shape * track.gain * 0.5;
        }
      });
    }
  }
  return { samples: normalize(samples), sampleRate: SAMPLE_RATE };
}
