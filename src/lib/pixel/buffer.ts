/**
 * The pixel buffer under the editor. A picture is plain RGBA bytes (the same
 * `Pixels` the sprite pipeline uses); every edit goes through a `Stroke`, which
 * remembers what each touched pixel looked like, so an undo step is exact.
 * Nothing here knows about the browser.
 */
import type { Pixels } from "../sprite";

export type { Pixels };

/** Red, green, blue, alpha: each 0–255. */
export type Rgba = readonly [number, number, number, number];

export const TRANSPARENT: Rgba = [0, 0, 0, 0];

/** `#rgb` or `#rrggbb` (any case) as an opaque colour; null for anything else. */
export function parseHex(value: string): Rgba | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
    255,
  ];
}

/** `#rrggbb`: alpha is not part of a hex colour. */
export function toHex(color: Rgba): string {
  return `#${[color[0], color[1], color[2]].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function packColor(color: Rgba): number {
  return ((color[0] << 24) | (color[1] << 16) | (color[2] << 8) | color[3]) >>> 0;
}

export function unpackColor(packed: number): Rgba {
  return [(packed >>> 24) & 255, (packed >>> 16) & 255, (packed >>> 8) & 255, packed & 255];
}

/** Every fully transparent colour looks the same, so it counts as the same colour. */
export function sameColor(a: Rgba, b: Rgba): boolean {
  if (a[3] === 0 && b[3] === 0) return true;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

export function createPixels(width: number, height: number, fill: Rgba = TRANSPARENT): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill[3] !== 0) {
    for (let at = 0; at < data.length; at += 4) data.set(fill, at);
  }
  return { width, height, data };
}

export function clonePixels(pixels: Pixels): Pixels {
  return { width: pixels.width, height: pixels.height, data: new Uint8ClampedArray(pixels.data) };
}

export function pixelsEqual(a: Pixels, b: Pixels): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let index = 0; index < a.data.length; index += 1) {
    if (a.data[index] !== b.data[index]) return false;
  }
  return true;
}

function inBounds(pixels: Pixels, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < pixels.width && y < pixels.height;
}

export function readPixel(pixels: Pixels, x: number, y: number): Rgba | null {
  if (!inBounds(pixels, x, y)) return null;
  const at = (y * pixels.width + x) * 4;
  return [pixels.data[at], pixels.data[at + 1], pixels.data[at + 2], pixels.data[at + 3]];
}

/** Bresenham: every pixel from one end to the other, both ends included, no gaps. */
export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const points: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    points.push([x, y]);
    if (x === x1 && y === y1) return points;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
}

/** What each touched pixel looked like before the stroke began (packed RGBA). */
export type Stroke = { before: Map<number, number> };

/** One undo step: the pixels a stroke really changed, with both sides. */
export type Change = { serial: number; indices: number[]; before: number[]; after: number[] };

export function beginStroke(): Stroke {
  return { before: new Map() };
}

function packedAt(pixels: Pixels, index: number): number {
  const at = index * 4;
  return packColor([pixels.data[at], pixels.data[at + 1], pixels.data[at + 2], pixels.data[at + 3]]);
}

function writePacked(pixels: Pixels, index: number, packed: number): void {
  const at = index * 4;
  pixels.data[at] = (packed >>> 24) & 255;
  pixels.data[at + 1] = (packed >>> 16) & 255;
  pixels.data[at + 2] = (packed >>> 8) & 255;
  pixels.data[at + 3] = packed & 255;
}

function write(pixels: Pixels, stroke: Stroke, index: number, color: Rgba): void {
  if (!stroke.before.has(index)) stroke.before.set(index, packedAt(pixels, index));
  writePacked(pixels, index, color[3] === 0 ? 0 : packColor(color));
}

/** Paints one pixel. Points outside the picture are ignored, not wrapped. */
export function paintAt(pixels: Pixels, stroke: Stroke, x: number, y: number, color: Rgba): void {
  if (!inBounds(pixels, x, y)) return;
  write(pixels, stroke, y * pixels.width + x, color);
}

/** Paints from the last pointer position to this one so a fast drag leaves no gaps. */
export function paintLine(
  pixels: Pixels,
  stroke: Stroke,
  from: readonly [number, number] | null,
  to: readonly [number, number],
  color: Rgba,
): void {
  if (!from) {
    paintAt(pixels, stroke, to[0], to[1], color);
    return;
  }
  for (const [x, y] of linePoints(from[0], from[1], to[0], to[1])) paintAt(pixels, stroke, x, y, color);
}

/**
 * Paint bucket: recolours the connected area (up and down, left and right, not
 * diagonally) of the pixel that was clicked. Returns how many pixels changed.
 * An explicit stack and a visited map keep it linear and loop-free on any picture.
 */
export function fillAt(pixels: Pixels, stroke: Stroke, x: number, y: number, color: Rgba): number {
  const target = readPixel(pixels, x, y);
  if (!target || sameColor(target, color)) return 0;
  const { width, height, data } = pixels;
  const matches = (index: number) => {
    const at = index * 4;
    if (target[3] === 0) return data[at + 3] === 0;
    return data[at] === target[0] && data[at + 1] === target[1] && data[at + 2] === target[2] && data[at + 3] === target[3];
  };
  const seen = new Uint8Array(width * height);
  const stack = [y * width + x];
  seen[stack[0]] = 1;
  let changed = 0;
  while (stack.length) {
    const index = stack.pop() as number;
    write(pixels, stroke, index, color);
    changed += 1;
    const px = index % width;
    const py = (index - px) / width;
    const next: number[] = [];
    if (px > 0) next.push(index - 1);
    if (px < width - 1) next.push(index + 1);
    if (py > 0) next.push(index - width);
    if (py < height - 1) next.push(index + width);
    for (const neighbour of next) {
      if (seen[neighbour]) continue;
      seen[neighbour] = 1;
      if (matches(neighbour)) stack.push(neighbour);
    }
  }
  return changed;
}

/** Sets every pixel to one colour (clearing the picture is painting it transparent). */
export function paintAll(pixels: Pixels, stroke: Stroke, color: Rgba): void {
  for (let index = 0; index < pixels.width * pixels.height; index += 1) write(pixels, stroke, index, color);
}

/**
 * Ends a stroke. Pixels that came back to what they were do not count; null means
 * the stroke changed nothing and so is not an undo step.
 */
export function finishStroke(pixels: Pixels, stroke: Stroke, serial: number): Change | null {
  const indices: number[] = [];
  const before: number[] = [];
  const after: number[] = [];
  for (const index of [...stroke.before.keys()].sort((a, b) => a - b)) {
    const was = stroke.before.get(index) as number;
    const now = packedAt(pixels, index);
    if (was === now) continue;
    indices.push(index);
    before.push(was);
    after.push(now);
  }
  return indices.length ? { serial, indices, before, after } : null;
}

/** Undo is `before`, redo is `after`: the same pixels, written the other way. */
export function applyChange(pixels: Pixels, change: Change, side: "before" | "after"): void {
  const values = change[side];
  change.indices.forEach((index, at) => writePacked(pixels, index, values[at]));
}
