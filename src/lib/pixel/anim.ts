/**
 * Sprite animation as ordinary files: a PNG sheet plus a JSON note.
 *
 * The `animation` object is the same shape as an asset-pack manifest
 * (`animationSchema` in src/lib/assets/schema.ts): frame size, frames in index
 * order, duration in milliseconds, optional action states. Pygame reads those
 * files itself. Nothing here is a GameKit runtime.
 */
import { animationSchema } from "../assets/schema";
import { type Pixels, type Rgba, TRANSPARENT, createPixels, packColor, readPixel } from "./buffer";

export const SPRITE_ANIM_FORMAT = "gamekit.sprite-anim" as const;
export const SPRITE_MODULE_PATH = "sprite_anim.py";

/** How long a new frame waits. 125 ms is 8 frames a second. */
export const DEFAULT_DURATION_MS = 125;
export const MIN_DURATION_MS = 1;
export const MAX_DURATION_MS = 5_000;

/** A sheet stays a normal image. Wider animations wrap onto the next row. */
export const MAX_SHEET_SIDE = 2048;
export const MAX_ANIM_FRAMES = 24;
/** One layer of frames, total. A background-sized picture stays a single frame. */
export const MAX_ANIM_PIXELS = 256 * 256;
export const MAX_ANIM_LAYERS = 4;

/** Previous frame shown under the one being drawn, about 40%. */
export const ONION_ALPHA = 102;

export type AnimStateMap = Record<string, number[]>;

export type SpriteAnimation = {
  frameWidth: number;
  frameHeight: number;
  frames: { index: number; durationMs: number; name?: string }[];
  states?: AnimStateMap;
};

export type SpriteAnimDocument = {
  format: typeof SPRITE_ANIM_FORMAT;
  formatVersion: 1;
  image: string;
  animation: SpriteAnimation;
};

export type SheetLayout = { columns: number; rows: number; width: number; height: number };

/** `assets/hero.png` keeps its note at `assets/hero.anim.json`. */
export function animationSidecarPath(pngPath: string): string | null {
  if (!/\.png$/i.test(pngPath)) return null;
  return `${pngPath.slice(0, -4)}.anim.json`;
}

export function isAnimationSidecar(path: string): boolean {
  return path.endsWith(".anim.json");
}

/** Whole frames per second, written onto every frame as milliseconds. */
export function durationForFps(fps: number): number | null {
  if (!Number.isInteger(fps) || fps < 1 || fps > 30) return null;
  return Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, Math.round(1000 / fps)));
}

export function clampDuration(value: number): number | null {
  if (!Number.isInteger(value) || value < MIN_DURATION_MS || value > MAX_DURATION_MS) return null;
  return value;
}

/**
 * Left to right, then the next row. Null when the frames cannot fit a sheet
 * pygame can open.
 */
export function sheetLayout(frameWidth: number, frameHeight: number, count: number): SheetLayout | null {
  if (!Number.isInteger(frameWidth) || !Number.isInteger(frameHeight) || !Number.isInteger(count)) return null;
  if (frameWidth < 1 || frameHeight < 1 || count < 1 || count > MAX_ANIM_FRAMES) return null;
  if (frameWidth > MAX_SHEET_SIDE || frameHeight > MAX_SHEET_SIDE) return null;
  const columns = Math.max(1, Math.min(count, Math.floor(MAX_SHEET_SIDE / frameWidth)));
  const rows = Math.ceil(count / columns);
  const width = columns * frameWidth;
  const height = rows * frameHeight;
  if (width > MAX_SHEET_SIDE || height > MAX_SHEET_SIDE || width * height > 1024 * 1024) return null;
  return { columns, rows, width, height };
}

export function packSheet(frames: Pixels[]): Pixels | null {
  const first = frames[0];
  if (!first || frames.some((frame) => frame.width !== first.width || frame.height !== first.height)) return null;
  const layout = sheetLayout(first.width, first.height, frames.length);
  if (!layout) return null;
  const sheet = createPixels(layout.width, layout.height);
  frames.forEach((frame, index) => blitFrame(sheet, frame, index, layout.columns, false));
  return sheet;
}

/**
 * Frame 0 is the top-left cell of a sheet this editor wrote.
 * The sheet size has to be exactly the layout for `count`, so a padded last row
 * is not an extra frame.
 */
export function splitSheet(sheet: Pixels, frameWidth: number, frameHeight: number, count: number): Pixels[] | null {
  const layout = sheetLayout(frameWidth, frameHeight, count);
  if (!layout || layout.width !== sheet.width || layout.height !== sheet.height) return null;
  return Array.from({ length: count }, (_, index) => {
    const frame = createPixels(frameWidth, frameHeight);
    blitFrame(sheet, frame, index, layout.columns, true);
    return frame;
  });
}

/**
 * A sprite sheet from outside the editor: every cell of the grid, row by row.
 * Null when the frame size does not divide the picture, or there are too many cells.
 */
export function splitGrid(sheet: Pixels, frameWidth: number, frameHeight: number): Pixels[] | null {
  if (!Number.isInteger(frameWidth) || !Number.isInteger(frameHeight)) return null;
  if (frameWidth < 1 || frameHeight < 1 || frameWidth > 256 || frameHeight > 256) return null;
  if (sheet.width % frameWidth !== 0 || sheet.height % frameHeight !== 0) return null;
  const columns = sheet.width / frameWidth;
  const rows = sheet.height / frameHeight;
  const count = columns * rows;
  if (count < 1 || count > MAX_ANIM_FRAMES) return null;
  if (count * frameWidth * frameHeight > MAX_ANIM_PIXELS && count > 1) return null;
  return Array.from({ length: count }, (_, index) => {
    const frame = createPixels(frameWidth, frameHeight);
    blitFrame(sheet, frame, index, columns, true);
    return frame;
  });
}

function blitFrame(sheet: Pixels, frame: Pixels, index: number, columns: number, intoFrame: boolean): void {
  const col = index % columns;
  const row = Math.floor(index / columns);
  const originX = col * frame.width;
  const originY = row * frame.height;
  for (let y = 0; y < frame.height; y += 1) {
    const sheetAt = ((originY + y) * sheet.width + originX) * 4;
    const frameAt = y * frame.width * 4;
    const bytes = frame.width * 4;
    if (intoFrame) frame.data.set(sheet.data.subarray(sheetAt, sheetAt + bytes), frameAt);
    else sheet.data.set(frame.data.subarray(frameAt, frameAt + bytes), sheetAt);
  }
}

/** Source-over. A transparent source leaves the destination; a transparent destination becomes the source. */
export function blendPixel(dst: Rgba, src: Rgba): Rgba {
  if (src[3] === 0) return [dst[0], dst[1], dst[2], dst[3]];
  if (dst[3] === 0 || src[3] === 255) return [src[0], src[1], src[2], src[3]];
  const sa = src[3] / 255;
  const da = dst[3] / 255;
  const outA = sa + da * (1 - sa);
  const channel = (index: number) => Math.round((src[index] * sa + dst[index] * da * (1 - sa)) / outA);
  return [channel(0), channel(1), channel(2), Math.round(outA * 255)];
}

export function compositeLayers(layers: { visible: boolean; pixels: Pixels }[]): Pixels {
  const sample = layers[0]?.pixels;
  const out = createPixels(sample?.width ?? 1, sample?.height ?? 1);
  if (!sample) return out;
  for (const layer of layers) {
    if (!layer.visible) continue;
    const { pixels } = layer;
    for (let index = 0; index < pixels.width * pixels.height; index += 1) {
      const src = readPixel(pixels, index % pixels.width, Math.floor(index / pixels.width));
      if (!src || src[3] === 0) continue;
      const x = index % pixels.width;
      const y = Math.floor(index / pixels.width);
      const dst = readPixel(out, x, y) ?? TRANSPARENT;
      const mixed = blendPixel(dst, src);
      const at = index * 4;
      out.data[at] = mixed[0];
      out.data[at + 1] = mixed[1];
      out.data[at + 2] = mixed[2];
      out.data[at + 3] = mixed[3];
    }
  }
  return out;
}

/** Fades a pixel for onion skin. Colour stays; only alpha is scaled. */
export function fadePixel(color: Rgba, alpha: number): Rgba {
  if (color[3] === 0 || alpha <= 0) return TRANSPARENT;
  if (alpha >= 255) return [color[0], color[1], color[2], color[3]];
  return [color[0], color[1], color[2], Math.round((color[3] * alpha) / 255)];
}

/** Previous frame underneath, then the frame being drawn. The buffers passed in are not changed. */
export function onionSkin(current: Pixels, previous: Pixels | null): Pixels {
  if (!previous) return current;
  const out = createPixels(current.width, current.height);
  for (let y = 0; y < current.height; y += 1) {
    for (let x = 0; x < current.width; x += 1) {
      const under = fadePixel(readPixel(previous, x, y) ?? TRANSPARENT, ONION_ALPHA);
      const over = readPixel(current, x, y) ?? TRANSPARENT;
      const mixed = blendPixel(under, over);
      const at = (y * current.width + x) * 4;
      out.data[at] = mixed[0];
      out.data[at + 1] = mixed[1];
      out.data[at + 2] = mixed[2];
      out.data[at + 3] = mixed[3];
    }
  }
  return out;
}

export type FrameSource = { pixels: Pixels; durationMs: number; name?: string };

/**
 * The sheet and the note for one save. Null when the frames disagree or cannot
 * fit. Frame index is the array position, so the sheet and the JSON cannot drift.
 */
export function buildSpriteDocument(
  imagePath: string,
  frames: FrameSource[],
  states: AnimStateMap,
): { sheet: Pixels; json: string; document: SpriteAnimDocument } | null {
  const sheet = packSheet(frames.map((frame) => frame.pixels));
  if (!sheet || !frames.length) return null;
  const animation: SpriteAnimation = {
    frameWidth: frames[0].pixels.width,
    frameHeight: frames[0].pixels.height,
    frames: frames.map((frame, index) => {
      const durationMs = clampDuration(frame.durationMs);
      if (durationMs === null) return { index: -1, durationMs: 0 };
      const entry: SpriteAnimation["frames"][number] = { index, durationMs };
      const name = frame.name?.trim();
      if (name) entry.name = name;
      return entry;
    }),
  };
  if (animation.frames.some((frame) => frame.index < 0)) return null;
  const cleaned = cleanStates(states, frames.length);
  if (cleaned === null) return null;
  if (Object.keys(cleaned).length) animation.states = cleaned;
  const document: SpriteAnimDocument = {
    format: SPRITE_ANIM_FORMAT,
    formatVersion: 1,
    image: imagePath,
    animation,
  };
  const parsed = parseSpriteAnim(JSON.stringify(document), imagePath);
  if (!parsed.ok) return null;
  return { sheet, json: `${JSON.stringify(document, null, 2)}\n`, document };
}

/** Empty states are omitted. A bad index fails the whole note instead of being dropped. */
function cleanStates(states: AnimStateMap, frameCount: number): AnimStateMap | null {
  const next: AnimStateMap = {};
  for (const [name, indices] of Object.entries(states)) {
    const trimmed = name.trim();
    if (!trimmed || !indices.length) continue;
    if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= frameCount)) return null;
    next[trimmed] = [...indices];
  }
  return next;
}

export type AnimParse = { ok: true; document: SpriteAnimDocument } | { ok: false; reason: "json" | "shape" | "frames" | "states" | "image" };

/** Reads a note. Frame order is index order. `expectedImage` must match the file the sheet was saved as. */
export function parseSpriteAnim(text: string, expectedImage?: string): AnimParse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "json" };
  }
  if (!value || typeof value !== "object") return { ok: false, reason: "shape" };
  const record = value as { format?: unknown; formatVersion?: unknown; image?: unknown; animation?: unknown };
  if (record.format !== SPRITE_ANIM_FORMAT || record.formatVersion !== 1) return { ok: false, reason: "shape" };
  if (typeof record.image !== "string" || !record.image.trim()) return { ok: false, reason: "shape" };
  if (expectedImage !== undefined && record.image !== expectedImage) return { ok: false, reason: "image" };
  const animation = animationSchema.safeParse(record.animation);
  if (!animation.success) return { ok: false, reason: "shape" };
  const frames = [...animation.data.frames].sort((a, b) => a.index - b.index);
  if (frames.length > MAX_ANIM_FRAMES) return { ok: false, reason: "frames" };
  const indices = frames.map((frame) => frame.index);
  if (indices.some((index, at) => index !== at)) return { ok: false, reason: "frames" };
  if (frames.some((frame) => clampDuration(frame.durationMs) === null)) return { ok: false, reason: "frames" };
  const states = animation.data.states ?? {};
  for (const indicesOfState of Object.values(states)) {
    if (indicesOfState.some((index) => index >= frames.length)) return { ok: false, reason: "states" };
  }
  const document: SpriteAnimDocument = {
    format: SPRITE_ANIM_FORMAT,
    formatVersion: 1,
    image: record.image,
    animation: {
      frameWidth: animation.data.frameWidth,
      frameHeight: animation.data.frameHeight,
      frames: frames.map((frame) => (frame.name ? { index: frame.index, durationMs: frame.durationMs, name: frame.name } : { index: frame.index, durationMs: frame.durationMs })),
      ...(Object.keys(states).length ? { states } : {}),
    },
  };
  return { ok: true, document };
}

/** Splits a saved sheet. Null when the picture size and the note disagree: the caller keeps the picture whole. */
export function framesFromDocument(sheet: Pixels, document: SpriteAnimDocument): Pixels[] | null {
  const { frameWidth, frameHeight, frames } = document.animation;
  return splitSheet(sheet, frameWidth, frameHeight, frames.length);
}

export type PlayCursor = { order: number[]; cursor: number; into: number };

/** The frames a state plays, or every frame in order when the state is missing. */
export function playOrder(frameCount: number, states: AnimStateMap, state: string | null): number[] {
  if (state && states[state]?.length) {
    return states[state].filter((index) => index >= 0 && index < frameCount);
  }
  return Array.from({ length: frameCount }, (_, index) => index);
}

/**
 * Moves a playhead by `dt` milliseconds. A long pause wraps by the total
 * length instead of stepping one frame at a time, so the result does not
 * depend on how often the clock fires.
 */
export function stepPlay(cursor: PlayCursor, dt: number, durations: readonly number[]): PlayCursor {
  const order = cursor.order;
  if (!order.length || !Number.isFinite(dt) || dt <= 0) return cursor;
  const total = order.reduce((sum, index) => sum + (durations[index] ?? 0), 0);
  if (total <= 0) return cursor;
  let into = cursor.into + dt;
  let at = cursor.cursor % order.length;
  if (into >= total) {
    into %= total;
    at = 0;
  }
  while (into >= durations[order[at]]) {
    into -= durations[order[at]];
    at = (at + 1) % order.length;
  }
  return { order, cursor: at, into };
}

/** What the child can paste into a game. Standard pygame only. */
export function pygameAnimSnippet(imagePath: string, jsonPath: string): string {
  return `import json
import pygame

sheet = pygame.image.load("${imagePath}").convert_alpha()
with open("${jsonPath}", encoding="utf-8") as handle:
    animation = json.load(handle)["animation"]
width = animation["frameWidth"]
height = animation["frameHeight"]
columns = sheet.get_width() // width
frames = []
for frame in animation["frames"]:
    index = frame["index"]
    area = pygame.Rect((index % columns) * width, (index // columns) * height, width, height)
    frames.append((sheet.subsurface(area).copy(), frame["durationMs"]))

# 在帧循环里累加毫秒，到了 durationMs 就换下一帧。states 里是动作，比如 idle、walk。
elapsed = 0
cursor = 0
# elapsed += clock.tick(60)
# while elapsed >= frames[cursor][1]:
#     elapsed -= frames[cursor][1]
#     cursor = (cursor + 1) % len(frames)
# screen.blit(frames[cursor][0], (x, y))
`;
}

/** A project file the child can import. Same timing rules as the snippet. */
export function pygameAnimModule(): string {
  return `"""按帧播放精灵表。只使用 pygame 和 JSON，不需要 GameKit。

animation 的字段和素材库清单一样：frameWidth、frameHeight、frames、states。
"""

import json
import pygame


def load_sprite(image_path, json_path):
    sheet = pygame.image.load(image_path).convert_alpha()
    with open(json_path, encoding="utf-8") as handle:
        animation = json.load(handle)["animation"]
    width = animation["frameWidth"]
    height = animation["frameHeight"]
    columns = sheet.get_width() // width
    frames = []
    for frame in animation["frames"]:
        index = frame["index"]
        area = pygame.Rect((index % columns) * width, (index // columns) * height, width, height)
        frames.append(
            {
                "image": sheet.subsurface(area).copy(),
                "duration_ms": frame["durationMs"],
                "index": index,
            }
        )
    return {"frames": frames, "states": animation.get("states") or {}, "width": width, "height": height}


class SpritePlayer:
    """order 是 states 里的帧号；cursor 是 order 里的位置；into 是这一帧已经过的毫秒。"""

    def __init__(self, sprite, state=None):
        self.sprite = sprite
        self.state = state
        self.cursor = 0
        self.into = 0

    def order(self):
        states = self.sprite["states"]
        if self.state and states.get(self.state):
            return states[self.state]
        return list(range(len(self.sprite["frames"])))

    def update(self, dt_ms):
        order = self.order()
        frames = self.sprite["frames"]
        if not order or dt_ms <= 0:
            return
        total = 0
        for index in order:
            total += frames[index]["duration_ms"]
        if total <= 0:
            return
        self.into += dt_ms
        if self.into >= total:
            self.into %= total
            self.cursor = 0
        while self.into >= frames[order[self.cursor]]["duration_ms"]:
            self.into -= frames[order[self.cursor]]["duration_ms"]
            self.cursor = (self.cursor + 1) % len(order)

    def image(self):
        order = self.order()
        return self.sprite["frames"][order[self.cursor]]["image"]
`;
}

/** A whole main.py that plays the sheet and prints one line the stage can show. */
export function pygameAnimDemo(imagePath: string, jsonPath: string): string {
  return `import asyncio
import json
import pygame

pygame.init()
screen = pygame.display.set_mode((320, 240))
clock = pygame.time.Clock()
sheet = pygame.image.load("${imagePath}").convert_alpha()
with open("${jsonPath}", encoding="utf-8") as handle:
    animation = json.load(handle)["animation"]
width = animation["frameWidth"]
height = animation["frameHeight"]
columns = sheet.get_width() // width
frames = []
for frame in animation["frames"]:
    index = frame["index"]
    area = pygame.Rect((index % columns) * width, (index // columns) * height, width, height)
    frames.append((sheet.subsurface(area).copy(), frame["durationMs"]))
sample = frames[0][0].get_at((min(1, width - 1), min(1, height - 1)))
print("ANIM-OK", len(frames), ",".join(str(item[1]) for item in frames))
print("ANIM-PIXEL", sample.r, sample.g, sample.b, sample.a)


async def main():
    elapsed = 0
    cursor = 0
    while True:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return
        elapsed += clock.tick(60)
        while frames and elapsed >= frames[cursor][1]:
            elapsed -= frames[cursor][1]
            cursor = (cursor + 1) % len(frames)
        screen.fill((30, 32, 46))
        screen.blit(frames[cursor][0], (160 - width // 2, 120 - height // 2))
        pygame.display.flip()
        await asyncio.sleep(0)


asyncio.run(main())
`;
}

/** Packed RGBA, used when a move has to remember every pixel it changed. */
export function packedPixel(pixels: Pixels, index: number): number {
  const at = index * 4;
  return packColor([pixels.data[at], pixels.data[at + 1], pixels.data[at + 2], pixels.data[at + 3]]);
}
