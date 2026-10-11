import { describe, expect, it } from "vitest";
import { animationSchema } from "../assets/schema";
import { type Pixels, type Rgba, createPixels, readPixel } from "./buffer";
import { decodePng, encodePng } from "./png";
import {
  DEFAULT_DURATION_MS,
  ONION_ALPHA,
  animationSidecarPath,
  blendPixel,
  buildSpriteDocument,
  compositeLayers,
  durationForFps,
  fadePixel,
  framesFromDocument,
  isAnimationSidecar,
  onionSkin,
  packSheet,
  parseSpriteAnim,
  playOrder,
  pygameAnimDemo,
  pygameAnimModule,
  pygameAnimSnippet,
  sheetLayout,
  splitGrid,
  splitSheet,
  stepPlay,
} from "./anim";

const RED: Rgba = [200, 10, 10, 200];
const GREEN: Rgba = [0, 180, 40, 255];
const HALF_GREEN: Rgba = [0, 255, 0, 128];
const OPAQUE_RED: Rgba = [255, 0, 0, 255];

function paint(pixels: Pixels, x: number, y: number, color: Rgba): void {
  const at = (y * pixels.width + x) * 4;
  pixels.data.set(color, at);
}

function frame(width: number, height: number, spots: [number, number, Rgba][]): Pixels {
  const pixels = createPixels(width, height);
  for (const [x, y, color] of spots) paint(pixels, x, y, color);
  return pixels;
}

describe("sprite sheets", () => {
  it("keeps frame order and alpha, including a wrapped row", () => {
    const frames = [
      frame(4, 2, [[0, 0, RED]]),
      frame(4, 2, [[1, 1, GREEN]]),
      frame(4, 2, [[3, 0, [1, 2, 3, 0]]]),
    ];
    const sheet = packSheet(frames);
    expect(sheet?.width).toBe(12);
    expect(sheet?.height).toBe(2);
    const back = sheet ? splitSheet(sheet, 4, 2, 3) : null;
    expect(back).toEqual(frames);

    const wide = [frame(1000, 8, [[0, 0, RED]]), frame(1000, 8, [[2, 2, GREEN]]), frame(1000, 8, [[4, 4, RED]])];
    const wrapped = packSheet(wide);
    expect(sheetLayout(1000, 8, 3)).toMatchObject({ columns: 2, rows: 2, width: 2000, height: 16 });
    const restored = wrapped ? splitSheet(wrapped, 1000, 8, 3) : null;
    expect(restored).toEqual(wide);
    expect(readPixel(wrapped as Pixels, 4, 4 + 8)).toEqual(RED);
    // A padded cell makes 3 and 4 frames the same sheet size. The note's frame count decides.
    expect(splitSheet(wrapped as Pixels, 1000, 8, 5)).toBeNull();
  });

  it("reads an outside sheet row by row and refuses a size that does not divide", () => {
    const sheet = createPixels(8, 4);
    paint(sheet, 0, 0, RED);
    paint(sheet, 5, 0, GREEN);
    paint(sheet, 1, 3, RED);
    const frames = splitGrid(sheet, 4, 2);
    expect(frames).toHaveLength(4);
    expect(readPixel(frames?.[0] as Pixels, 0, 0)).toEqual(RED);
    expect(readPixel(frames?.[1] as Pixels, 1, 0)).toEqual(GREEN);
    expect(readPixel(frames?.[2] as Pixels, 1, 1)).toEqual(RED);
    expect(splitGrid(sheet, 3, 2)).toBeNull();
    expect(splitGrid(sheet, 300, 2)).toBeNull();
  });

  it("writes a PNG whose pixels match the sheet, alpha included", () => {
    const built = buildSpriteDocument(
      "assets/hero.png",
      [
        { pixels: frame(2, 2, [[0, 1, RED]]), durationMs: 200, name: "站立" },
        { pixels: frame(2, 2, [[1, 0, GREEN]]), durationMs: 80 },
      ],
      { idle: [0], walk: [1] },
    );
    expect(built).not.toBeNull();
    if (!built) return;
    const decoded = decodePng(encodePng(built.sheet));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.pixels).toEqual(built.sheet);
    expect(readPixel(decoded.pixels, 0, 1)).toEqual(RED);
    expect(readPixel(decoded.pixels, 3, 0)).toEqual(GREEN);
    expect(readPixel(decoded.pixels, 0, 0)?.[3]).toBe(0);
    const opened = framesFromDocument(decoded.pixels, built.document);
    expect(opened).toEqual([
      frame(2, 2, [[0, 1, RED]]),
      frame(2, 2, [[1, 0, GREEN]]),
    ]);
  });
});

describe("animation notes", () => {
  it("uses the same animation fields as an asset pack", () => {
    const built = buildSpriteDocument("assets/hero.png", [{ pixels: frame(2, 2, []), durationMs: DEFAULT_DURATION_MS }], { walk: [0] });
    expect(built).not.toBeNull();
    if (!built) return;
    expect(animationSchema.safeParse(built.document.animation).success).toBe(true);
    expect(animationSidecarPath("assets/hero.png")).toBe("assets/hero.anim.json");
    expect(isAnimationSidecar("assets/hero.anim.json")).toBe(true);
    const again = parseSpriteAnim(built.json, "assets/hero.png");
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.document.animation.frames.map((item) => item.index)).toEqual([0]);
    expect(again.document.animation.states).toEqual({ walk: [0] });
  });

  it("rejects notes that would rename, reorder, or invent frames", () => {
    const good = buildSpriteDocument(
      "assets/hero.png",
      [
        { pixels: frame(2, 2, []), durationMs: 100 },
        { pixels: frame(2, 2, []), durationMs: 100 },
      ],
      {},
    );
    expect(good).not.toBeNull();
    if (!good) return;
    const body = JSON.parse(good.json) as { animation: { frames: { index: number }[] }; image: string };
    expect(parseSpriteAnim(good.json, "assets/other.png")).toEqual({ ok: false, reason: "image" });
    body.animation.frames = [{ index: 0 }, { index: 0 }];
    expect(parseSpriteAnim(JSON.stringify(body), "assets/hero.png").ok).toBe(false);
    body.animation.frames = [{ index: 0 }, { index: 2 }];
    expect(parseSpriteAnim(JSON.stringify({ ...JSON.parse(good.json), animation: { ...JSON.parse(good.json).animation, frames: [{ index: 0, durationMs: 10 }, { index: 2, durationMs: 10 }] } }), "assets/hero.png")).toMatchObject({
      ok: false,
      reason: "frames",
    });
    expect(parseSpriteAnim("{", "assets/hero.png")).toEqual({ ok: false, reason: "json" });
    expect(parseSpriteAnim(JSON.stringify({ format: "other", formatVersion: 1, image: "assets/hero.png" }), "assets/hero.png")).toEqual({
      ok: false,
      reason: "shape",
    });
    const swapped = JSON.parse(good.json) as { animation: { frames: { index: number; durationMs: number }[] } };
    swapped.animation.frames = [
      { index: 1, durationMs: 40 },
      { index: 0, durationMs: 90 },
    ];
    const ordered = parseSpriteAnim(JSON.stringify(swapped), "assets/hero.png");
    expect(ordered.ok).toBe(true);
    if (!ordered.ok) return;
    expect(ordered.document.animation.frames.map((item) => item.durationMs)).toEqual([90, 40]);
  });

  it("rejects a state that points past the last frame", () => {
    const good = buildSpriteDocument("assets/hero.png", [{ pixels: frame(2, 2, []), durationMs: 100 }], {});
    expect(good).not.toBeNull();
    if (!good) return;
    const body = JSON.parse(good.json) as { animation: { states?: Record<string, number[]> } };
    body.animation.states = { jump: [3] };
    expect(parseSpriteAnim(JSON.stringify(body), "assets/hero.png")).toMatchObject({ ok: false, reason: "states" });
  });
});

describe("playback", () => {
  it("follows durations and wraps inside a state", () => {
    const durations = [200, 80, 80];
    expect(stepPlay({ order: [0, 1, 2], cursor: 0, into: 0 }, 199, durations)).toEqual({ order: [0, 1, 2], cursor: 0, into: 199 });
    expect(stepPlay({ order: [0, 1, 2], cursor: 0, into: 0 }, 200, durations)).toEqual({ order: [0, 1, 2], cursor: 1, into: 0 });
    expect(stepPlay({ order: [0, 1, 2], cursor: 0, into: 0 }, 280, durations)).toEqual({ order: [0, 1, 2], cursor: 2, into: 0 });
    expect(stepPlay({ order: [0, 1, 2], cursor: 0, into: 0 }, 200 + 80 + 80 + 5, durations)).toEqual({
      order: [0, 1, 2],
      cursor: 0,
      into: 5,
    });
    const walk = playOrder(3, { idle: [0], walk: [2, 1] }, "walk");
    expect(stepPlay({ order: walk, cursor: 0, into: 0 }, 80, durations)).toEqual({ order: [2, 1], cursor: 1, into: 0 });
    expect(durationForFps(8)).toBe(125);
    expect(durationForFps(0)).toBeNull();
  });
});

describe("layers and onion skin", () => {
  it("composites top over bottom and keeps a half-transparent pixel", () => {
    const bottom = frame(1, 1, [[0, 0, OPAQUE_RED]]);
    const top = frame(1, 1, [[0, 0, HALF_GREEN]]);
    expect(blendPixel(OPAQUE_RED, HALF_GREEN)).toEqual([127, 128, 0, 255]);
    const mixed = compositeLayers([
      { visible: true, pixels: bottom },
      { visible: true, pixels: top },
    ]);
    expect(readPixel(mixed, 0, 0)).toEqual([127, 128, 0, 255]);
    const hidden = compositeLayers([
      { visible: true, pixels: bottom },
      { visible: false, pixels: top },
    ]);
    expect(readPixel(hidden, 0, 0)).toEqual(OPAQUE_RED);
    const alone = compositeLayers([{ visible: true, pixels: top }]);
    expect(readPixel(alone, 0, 0)).toEqual(HALF_GREEN);
  });

  it("shows the previous frame through transparent pixels only", () => {
    const previous = frame(1, 1, [[0, 0, OPAQUE_RED]]);
    const current = createPixels(1, 1);
    const ghost = onionSkin(current, previous);
    expect(fadePixel(OPAQUE_RED, ONION_ALPHA)[3]).toBe(102);
    expect(readPixel(ghost, 0, 0)).toEqual([255, 0, 0, 102]);
    paint(current, 0, 0, GREEN);
    expect(readPixel(onionSkin(current, previous), 0, 0)).toEqual(GREEN);
  });
});

describe("pygame playback text", () => {
  it("is ordinary pygame and names the same files the editor saves", () => {
    const snippet = pygameAnimSnippet("assets/hero.png", "assets/hero.anim.json");
    const moduleText = pygameAnimModule();
    const demo = pygameAnimDemo("assets/hero.png", "assets/hero.anim.json");
    for (const source of [snippet, moduleText, demo]) {
      expect(source).toContain('pygame.image.load(');
      expect(source).toContain("convert_alpha()");
      expect(source).toContain("durationMs");
      expect(source).toContain("subsurface");
      expect(source).not.toMatch(/import gamekit/i);
      expect(source).not.toContain("/asset-packs/");
    }
    expect(demo).toContain("await asyncio.sleep(0)");
    expect(demo).toContain("ANIM-OK");
    expect(demo).toContain("ANIM-PIXEL");
    expect(moduleText).toContain("class SpritePlayer");
  });
});
