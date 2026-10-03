/**
 * The pixel pipeline that turns a generated picture into a game asset. Pure
 * functions over pixel buffers: no browser, no canvas, hand-built images.
 */
import { describe, expect, it } from "vitest";
import { cutBackground, fitToSize, trimToContent, type Pixels } from "./sprite";

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const RED: [number, number, number, number] = [220, 40, 40, 255];

/** Builds an image from a list of rows; each character is one pixel. */
function image(rows: string[], palette: Record<string, [number, number, number, number]>): Pixels {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      const [r, g, b, a] = palette[cell];
      const at = (y * width + x) * 4;
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
      data[at + 3] = a;
    });
  });
  return { width, height, data };
}

function alphaAt(pixels: Pixels, x: number, y: number): number {
  return pixels.data[(y * pixels.width + x) * 4 + 3];
}

const PALETTE = { ".": WHITE, X: RED };
const SQUARE_WITH_MARGIN = ["......", ".XXXX.", ".XXXX.", ".XXXX.", ".XXXX.", "......"];

describe("cutBackground", () => {
  it("removes the border colour and keeps the subject", () => {
    const result = cutBackground(image(SQUARE_WITH_MARGIN, PALETTE));
    expect(alphaAt(result.image, 0, 0)).toBe(0);
    expect(alphaAt(result.image, 1, 1)).toBe(255);
    expect(alphaAt(result.image, 4, 4)).toBe(255);
    // 20 background pixels out of 36
    expect(result.removed).toBeCloseTo(20 / 36, 2);
  });

  it("does not eat a subject that shares the background colour", () => {
    // A red ring around a white middle: the middle must survive.
    const rows = ["XXXXXX", "X....X", "X....X", "X....X", "X....X", "XXXXXX"];
    const result = cutBackground(image(rows, PALETTE));
    expect(alphaAt(result.image, 3, 3)).toBe(255);
    expect(alphaAt(result.image, 0, 0)).toBe(0);
    expect(result.removed).toBeCloseTo(20 / 36, 2);
  });

  it("admits when there is nothing to cut", () => {
    const noisy = image(
      Array.from({ length: 4 }, (_, y) => Array.from({ length: 4 }, (_, x) => ((x + y) % 2 ? "X" : ".")).join("")),
      PALETTE,
    );
    expect(cutBackground(noisy).removed).toBeLessThan(0.05);
  });
});

describe("trimToContent", () => {
  it("crops to the visible pixels", () => {
    const cut = cutBackground(image(SQUARE_WITH_MARGIN, PALETTE)).image;
    const trimmed = trimToContent(cut);
    expect(trimmed.width).toBe(4);
    expect(trimmed.height).toBe(4);
    expect(alphaAt(trimmed, 0, 0)).toBe(255);
  });

  it("leaves a fully transparent image alone rather than returning nothing", () => {
    const transparent = image(["..", ".."], { ".": [0, 0, 0, 0] });
    expect(trimToContent(transparent)).toBe(transparent);
  });
});

describe("fitToSize", () => {
  const subject = image(["XX", "XX"], PALETTE);

  it("contains a square subject in a square target", () => {
    const out = fitToSize(subject, 4, 4, "contain");
    expect(out.width).toBe(4);
    expect(alphaAt(out, 0, 0)).toBe(255);
    expect(alphaAt(out, 3, 3)).toBe(255);
  });

  it("keeps a tall subject whole and pads with transparent pixels", () => {
    const tall = image(["X", "X", "X", "X"], PALETTE);
    const out = fitToSize(tall, 4, 4, "contain");
    // 4 wide input mapped into a square: one column of padding on each side
    expect(alphaAt(out, 0, 0)).toBe(0);
    expect(alphaAt(out, 2, 1)).toBe(255);
    expect(out.data[(0 * 4 + 2) * 4]).toBe(220);
  });

  it("covers the target in cover mode", () => {
    const wide = image(["XXXXXX", "XXXXXX"], PALETTE);
    const out = fitToSize(wide, 2, 2, "cover");
    expect(alphaAt(out, 0, 0)).toBe(255);
    expect(alphaAt(out, 1, 1)).toBe(255);
  });

  it("does not blur: every output pixel comes from the input", () => {
    const two = image(["XY", "YX"], {
      X: RED,
      Y: [0, 0, 255, 255],
    });
    const out = fitToSize(two, 4, 4, "contain");
    const colors = new Set(Array.from({ length: 16 }, (_, i) => out.data[i * 4] + "," + out.data[i * 4 + 2]));
    expect([...colors].sort()).toEqual(["0,255", "220,40"]);
  });
});
