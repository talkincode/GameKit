/**
 * PNG bytes ⇄ pixel buffer, with no browser in the way.
 *
 * Why not the canvas: `canvas.toBlob` goes through premultiplied alpha, so a
 * half-transparent pixel comes back with different colours. Writing the bytes
 * ourselves keeps every pixel exactly as drawn, and gives the same file every
 * time. The decoder reads the layouts pygame assets come in (gray, RGB, palette,
 * with alpha, 1–16 bits); interlaced files are reported, not guessed at.
 */
import { unzlibSync, zlibSync } from "fflate";
import type { Pixels } from "./buffer";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A plain 8-bit RGBA PNG holding exactly these pixels. */
export function encodePng(pixels: Pixels): Uint8Array {
  const { width, height, data } = pixels;
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);

  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    // Filter type 0 (none): pixel art compresses well enough, and nothing is altered.
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk("IHDR", header),
    chunk("IDAT", zlibSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export type PngDecode =
  | { ok: true; pixels: Pixels }
  /** not-png: other bytes · corrupt: damaged · unsupported: interlaced · too-big: over the pixel limit */
  | { ok: false; problem: "not-png" | "corrupt" | "unsupported" | "too-big" };

const SAMPLES: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
}

/** Reads a PNG into 8-bit RGBA. `maxPixels` is checked before anything is inflated. */
export function decodePng(bytes: Uint8Array, maxPixels = 4096 * 4096): PngDecode {
  if (bytes.length < 8 || SIGNATURE.some((value, index) => bytes[index] !== value)) return { ok: false, problem: "not-png" };
  const corrupt = { ok: false, problem: "corrupt" } as const;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let header: { width: number; height: number; depth: number; colorType: number; interlace: number } | null = null;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const parts: Uint8Array[] = [];
  let ended = false;

  for (let at = 8; at + 12 <= bytes.length && !ended; ) {
    const length = view.getUint32(at);
    if (at + 12 + length > bytes.length) return corrupt;
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      if (length !== 13) return corrupt;
      header = {
        width: view.getUint32(at + 8),
        height: view.getUint32(at + 12),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") transparency = data;
    else if (type === "IDAT") parts.push(data);
    else if (type === "IEND") ended = true;
    at += 12 + length;
  }
  if (!header || !parts.length) return corrupt;

  const { width, height, depth, colorType, interlace } = header;
  if (!width || !height || !(colorType in SAMPLES) || !DEPTHS[colorType].includes(depth)) return corrupt;
  if (width * height > maxPixels) return { ok: false, problem: "too-big" };
  if (interlace !== 0) return { ok: false, problem: "unsupported" };
  if (colorType === 3 && !palette) return corrupt;

  const bitsPerPixel = SAMPLES[colorType] * depth;
  const step = Math.max(1, bitsPerPixel / 8);
  const stride = Math.ceil((width * bitsPerPixel) / 8);

  let raw: Uint8Array;
  try {
    const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      joined.set(part, offset);
      offset += part.length;
    }
    raw = unzlibSync(joined);
  } catch {
    return corrupt;
  }
  if (raw.length < (stride + 1) * height) return corrupt;

  // Undo the per-row filters in place.
  const lines = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) return corrupt;
    const source = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= step ? lines[y * stride + x - step] : 0;
      const up = y ? lines[(y - 1) * stride + x] : 0;
      const upLeft = y && x >= step ? lines[(y - 1) * stride + x - step] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) predicted = paeth(left, up, upLeft);
      lines[y * stride + x] = (source[x] + predicted) & 255;
    }
  }

  const out = new Uint8ClampedArray(width * height * 4);
  const max = (1 << Math.min(depth, 8)) - 1;
  // Reads sample number `n` of a row as its raw value (16-bit samples stay 16-bit here).
  const sampleAt = (row: number, n: number): number => {
    const base = row * stride;
    if (depth === 16) return (lines[base + n * 2] << 8) | lines[base + n * 2 + 1];
    if (depth === 8) return lines[base + n];
    const bit = n * depth;
    return (lines[base + (bit >> 3)] >> (8 - depth - (bit & 7))) & max;
  };
  const toByte = (value: number) => (depth === 16 ? value >> 8 : depth === 8 ? value : Math.round((value * 255) / max));
  const key = transparency && transparency.length >= 2 ? (transparency[0] << 8) | transparency[1] : -1;
  const keyRgb =
    transparency && transparency.length >= 6
      ? [0, 2, 4].map((index) => (transparency![index] << 8) | transparency![index + 1])
      : null;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const to = (y * width + x) * 4;
      if (colorType === 3) {
        const index = sampleAt(y, x);
        if (!palette || index * 3 + 2 >= palette.length) return corrupt;
        out[to] = palette[index * 3];
        out[to + 1] = palette[index * 3 + 1];
        out[to + 2] = palette[index * 3 + 2];
        out[to + 3] = transparency && index < transparency.length ? transparency[index] : 255;
      } else if (colorType === 0 || colorType === 4) {
        const value = sampleAt(y, x * SAMPLES[colorType]);
        const gray = toByte(value);
        out[to] = gray;
        out[to + 1] = gray;
        out[to + 2] = gray;
        out[to + 3] = colorType === 4 ? toByte(sampleAt(y, x * 2 + 1)) : value === key ? 0 : 255;
      } else {
        const r = sampleAt(y, x * SAMPLES[colorType]);
        const g = sampleAt(y, x * SAMPLES[colorType] + 1);
        const b = sampleAt(y, x * SAMPLES[colorType] + 2);
        out[to] = toByte(r);
        out[to + 1] = toByte(g);
        out[to + 2] = toByte(b);
        out[to + 3] =
          colorType === 6 ? toByte(sampleAt(y, x * 4 + 3)) : keyRgb && r === keyRgb[0] && g === keyRgb[1] && b === keyRgb[2] ? 0 : 255;
      }
    }
  }
  return { ok: true, pixels: { width, height, data: out } };
}
