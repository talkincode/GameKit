/**
 * The pixel buffer under the editor: colours, lines, flood fill and the stroke
 * recorder that undo is built on. Pure functions over hand-built pictures.
 */
import { describe, expect, it } from "vitest";
import {
  TRANSPARENT,
  applyChange,
  beginStroke,
  clonePixels,
  createPixels,
  fillAt,
  finishStroke,
  linePoints,
  packColor,
  paintAt,
  paintLine,
  parseHex,
  pixelsEqual,
  readPixel,
  sameColor,
  toHex,
  unpackColor,
  type Pixels,
  type Rgba,
} from "./buffer";

const RED: Rgba = [220, 40, 40, 255];
const BLUE: Rgba = [40, 80, 220, 255];

/** Draws a picture as rows of characters: `.` transparent, `R` red, `B` blue. */
function picture(rows: string[]): Pixels {
  const pixels = createPixels(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      const color = cell === "R" ? RED : cell === "B" ? BLUE : TRANSPARENT;
      pixels.data.set(color, (y * pixels.width + x) * 4);
    });
  });
  return pixels;
}

function rowsOf(pixels: Pixels): string[] {
  const rows: string[] = [];
  for (let y = 0; y < pixels.height; y += 1) {
    let row = "";
    for (let x = 0; x < pixels.width; x += 1) {
      const color = readPixel(pixels, x, y) as Rgba;
      row += color[3] === 0 ? "." : sameColor(color, RED) ? "R" : sameColor(color, BLUE) ? "B" : "?";
    }
    rows.push(row);
  }
  return rows;
}

describe("colours", () => {
  it("reads #rgb and #rrggbb, and refuses everything else", () => {
    expect(parseHex("#ff0080")).toEqual([255, 0, 128, 255]);
    expect(parseHex("#F08")).toEqual([255, 0, 136, 255]);
    expect(parseHex("ff0080")).toBeNull();
    expect(parseHex("#ff00")).toBeNull();
    expect(parseHex("#gg0000")).toBeNull();
    expect(parseHex("")).toBeNull();
  });

  it("writes colours back as lowercase #rrggbb", () => {
    expect(toHex([255, 0, 128, 255])).toBe("#ff0080");
    expect(toHex(parseHex("#0A0b0C") as Rgba)).toBe("#0a0b0c");
  });

  it("packs and unpacks every channel, including high alpha", () => {
    for (const color of [[0, 0, 0, 0], [255, 255, 255, 255], [1, 2, 3, 4], [250, 128, 7, 200]] as Rgba[]) {
      expect(unpackColor(packColor(color))).toEqual(color);
    }
  });

  it("treats every fully transparent colour as the same colour", () => {
    expect(sameColor([0, 0, 0, 0], [255, 0, 255, 0])).toBe(true);
    expect(sameColor([0, 0, 0, 1], [0, 0, 0, 0])).toBe(false);
    expect(sameColor(RED, [220, 40, 40, 255])).toBe(true);
    expect(sameColor(RED, BLUE)).toBe(false);
  });
});

describe("createPixels", () => {
  it("starts transparent, or filled with one colour", () => {
    const empty = createPixels(3, 2);
    expect(empty.data.length).toBe(24);
    expect(empty.data.every((value) => value === 0)).toBe(true);
    expect(rowsOf(createPixels(2, 2, RED))).toEqual(["RR", "RR"]);
  });

  it("clones without sharing memory", () => {
    const original = picture(["R."]);
    const copy = clonePixels(original);
    copy.data[3] = 0;
    expect(rowsOf(original)).toEqual(["R."]);
    expect(pixelsEqual(original, copy)).toBe(false);
    expect(pixelsEqual(original, clonePixels(original))).toBe(true);
  });

  it("says out-of-bounds reads are nothing, never a crash", () => {
    const pixels = picture(["R."]);
    expect(readPixel(pixels, -1, 0)).toBeNull();
    expect(readPixel(pixels, 2, 0)).toBeNull();
    expect(readPixel(pixels, 0, 1)).toBeNull();
  });
});

describe("linePoints", () => {
  it("includes both ends and leaves no gap, in any direction", () => {
    const cases: [number, number, number, number][] = [
      [0, 0, 7, 3],
      [7, 3, 0, 0],
      [0, 5, 0, 0],
      [2, 2, 2, 2],
      [0, 0, 5, 5],
      [3, 0, 0, 6],
    ];
    for (const [x0, y0, x1, y1] of cases) {
      const points = linePoints(x0, y0, x1, y1);
      expect(points[0]).toEqual([x0, y0]);
      expect(points.at(-1)).toEqual([x1, y1]);
      expect(points.length).toBe(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1);
      for (let index = 1; index < points.length; index += 1) {
        expect(Math.abs(points[index][0] - points[index - 1][0])).toBeLessThanOrEqual(1);
        expect(Math.abs(points[index][1] - points[index - 1][1])).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("painting", () => {
  it("paints one pixel and remembers what was there", () => {
    const pixels = picture(["...", "..."]);
    const stroke = beginStroke();
    paintAt(pixels, stroke, 1, 1, RED);
    expect(rowsOf(pixels)).toEqual(["...", ".R."]);
    const change = finishStroke(pixels, stroke, 1);
    expect(Array.from(change?.indices ?? [])).toEqual([4]);
    expect(Array.from(change?.before ?? [])).toEqual([packColor(TRANSPARENT)]);
    expect(Array.from(change?.after ?? [])).toEqual([packColor(RED)]);
  });

  it("ignores points outside the picture instead of wrapping or throwing", () => {
    const pixels = picture(["..", ".."]);
    const stroke = beginStroke();
    paintAt(pixels, stroke, -1, 0, RED);
    paintAt(pixels, stroke, 2, 0, RED);
    paintAt(pixels, stroke, 0, 2, RED);
    paintAt(pixels, stroke, 0, -3, RED);
    expect(rowsOf(pixels)).toEqual(["..", ".."]);
    expect(finishStroke(pixels, stroke, 1)).toBeNull();
  });

  it("draws a continuous line even when the pointer jumps", () => {
    const pixels = picture(["........", "........", "........"]);
    const stroke = beginStroke();
    paintLine(pixels, stroke, [0, 0], [7, 2], RED);
    const painted = rowsOf(pixels).join("").split("R").length - 1;
    expect(painted).toBe(8);
    expect(readPixel(pixels, 0, 0)).toEqual(RED);
    expect(readPixel(pixels, 7, 2)).toEqual(RED);
  });

  it("clips a line that starts or ends off the picture, keeping what is inside", () => {
    const pixels = picture(["....", "...."]);
    const stroke = beginStroke();
    paintLine(pixels, stroke, [-3, 0], [3, 0], RED);
    expect(rowsOf(pixels)).toEqual(["RRRR", "...."]);
  });

  it("a stroke records each pixel once, with its colour from before the stroke", () => {
    const pixels = picture(["R..."]);
    const stroke = beginStroke();
    paintAt(pixels, stroke, 1, 0, BLUE);
    paintAt(pixels, stroke, 1, 0, RED);
    paintAt(pixels, stroke, 2, 0, BLUE);
    const change = finishStroke(pixels, stroke, 7);
    expect(change?.serial).toBe(7);
    expect(Array.from(change?.indices ?? [])).toEqual([1, 2]);
    expect(Array.from(change?.before ?? [])).toEqual([packColor(TRANSPARENT), packColor(TRANSPARENT)]);
    expect(Array.from(change?.after ?? [])).toEqual([packColor(RED), packColor(BLUE)]);
  });

  it("drops pixels that ended up unchanged, and returns null when nothing changed", () => {
    const same = picture(["RR"]);
    const first = beginStroke();
    paintAt(same, first, 0, 0, RED);
    paintAt(same, first, 1, 0, RED);
    expect(finishStroke(same, first, 1)).toBeNull();

    const there = picture(["R."]);
    const second = beginStroke();
    paintAt(there, second, 0, 0, BLUE);
    paintAt(there, second, 0, 0, RED);
    expect(finishStroke(there, second, 1)).toBeNull();
  });

  it("painting transparent erases", () => {
    const pixels = picture(["RB"]);
    const stroke = beginStroke();
    paintAt(pixels, stroke, 0, 0, TRANSPARENT);
    expect(rowsOf(pixels)).toEqual([".B"]);
  });
});

describe("fillAt", () => {
  it("fills the connected area and stops at a wall", () => {
    const pixels = picture(["..R..", "..R..", "..R.."]);
    const stroke = beginStroke();
    expect(fillAt(pixels, stroke, 0, 0, BLUE)).toBe(6);
    expect(rowsOf(pixels)).toEqual(["BBR..", "BBR..", "BBR.."]);
  });

  it("does not leak diagonally", () => {
    const pixels = picture([".R", "R."]);
    const stroke = beginStroke();
    fillAt(pixels, stroke, 0, 0, BLUE);
    expect(rowsOf(pixels)).toEqual(["BR", "R."]);
  });

  it("fills the whole picture when nothing divides it", () => {
    const pixels = picture(["....", "....", "...."]);
    const stroke = beginStroke();
    expect(fillAt(pixels, stroke, 2, 1, RED)).toBe(12);
    expect(rowsOf(pixels)).toEqual(["RRRR", "RRRR", "RRRR"]);
  });

  it("does nothing, and cannot loop, when the colour is already there", () => {
    const pixels = picture(["RRR", "RRR"]);
    const stroke = beginStroke();
    expect(fillAt(pixels, stroke, 1, 1, RED)).toBe(0);
    expect(finishStroke(pixels, stroke, 1)).toBeNull();
  });

  it("treats transparent pixels with different hidden colours as one area", () => {
    const pixels = picture(["...."]);
    pixels.data.set([255, 0, 255, 0], 4);
    const stroke = beginStroke();
    expect(fillAt(pixels, stroke, 0, 0, RED)).toBe(4);
  });

  it("ignores a click outside the picture", () => {
    const pixels = picture(["..", ".."]);
    const stroke = beginStroke();
    expect(fillAt(pixels, stroke, 5, 5, RED)).toBe(0);
    expect(fillAt(pixels, stroke, -1, 0, RED)).toBe(0);
  });

  it("finishes quickly on a big empty picture", () => {
    const big = createPixels(256, 256);
    const stroke = beginStroke();
    const started = Date.now();
    expect(fillAt(big, stroke, 100, 100, RED)).toBe(256 * 256);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("fills a one-pixel-wide winding corridor without recursion limits", () => {
    const width = 301;
    const height = 301;
    const maze = createPixels(width, height, RED);
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 1) maze.data.set(TRANSPARENT, (y * width + x) * 4);
      // Every other connector sits at the right edge, the rest at the left: one long snake.
      if (y + 1 < height) maze.data.set(TRANSPARENT, ((y + 1) * width + ((y / 2) % 2 === 0 ? width - 1 : 0)) * 4);
    }
    const stroke = beginStroke();
    expect(fillAt(maze, stroke, 0, 0, BLUE)).toBe(151 * 301 + 150);
  });
});

describe("changes", () => {
  it("undo and redo are exact inverses", () => {
    const pixels = picture(["R.B", "..."]);
    const before = clonePixels(pixels);
    const stroke = beginStroke();
    fillAt(pixels, stroke, 1, 0, BLUE);
    paintAt(pixels, stroke, 0, 1, RED);
    const change = finishStroke(pixels, stroke, 1);
    expect(change).not.toBeNull();
    const after = clonePixels(pixels);

    applyChange(pixels, change!, "before");
    expect(pixelsEqual(pixels, before)).toBe(true);
    applyChange(pixels, change!, "after");
    expect(pixelsEqual(pixels, after)).toBe(true);
  });
});
