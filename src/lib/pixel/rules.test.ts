/**
 * The rules a child's choices go through before a picture exists: how big, what
 * it is called, how zoomed in it opens. Pure, so every refusal is tested.
 */
import { describe, expect, it } from "vitest";
import { parseHex } from "./buffer";
import { PALETTE } from "./palette";
import {
  MAX_EDIT_PIXELS,
  MAX_NEW_SIDE,
  SIZE_PRESETS,
  ZOOMS,
  canEditPixels,
  checkSize,
  defaultImagePath,
  fitScale,
  imagePath,
  startZoom,
  boardBudget,
  stepZoom,
} from "./rules";

describe("checkSize", () => {
  it("accepts whole numbers from 1 to the limit, as numbers or typed text", () => {
    expect(checkSize(16, 16)).toEqual({ ok: true, width: 16, height: 16 });
    expect(checkSize("32", " 48 ")).toEqual({ ok: true, width: 32, height: 48 });
    expect(checkSize(1, MAX_NEW_SIDE)).toEqual({ ok: true, width: 1, height: MAX_NEW_SIDE });
  });

  it("offers presets that are all allowed", () => {
    expect([...SIZE_PRESETS]).toEqual([16, 32, 48, 64]);
    for (const size of SIZE_PRESETS) expect(checkSize(size, size).ok).toBe(true);
  });

  it("says which side is wrong, and why", () => {
    expect(checkSize("", 16)).toEqual({ ok: false, field: "width", reason: "number" });
    expect(checkSize(16, "abc")).toEqual({ ok: false, field: "height", reason: "number" });
    expect(checkSize("3.5", 16)).toEqual({ ok: false, field: "width", reason: "number" });
    expect(checkSize("1e2", 16)).toEqual({ ok: false, field: "width", reason: "number" });
    expect(checkSize("0x10", 16)).toEqual({ ok: false, field: "width", reason: "number" });
    expect(checkSize(0, 16)).toEqual({ ok: false, field: "width", reason: "small" });
    expect(checkSize(-4, 16)).toEqual({ ok: false, field: "width", reason: "small" });
    expect(checkSize(16, 0)).toEqual({ ok: false, field: "height", reason: "small" });
    expect(checkSize(MAX_NEW_SIDE + 1, 16)).toEqual({ ok: false, field: "width", reason: "big" });
    expect(checkSize(16, "99999999999999999999")).toEqual({ ok: false, field: "height", reason: "big" });
    expect(checkSize(Number.NaN, 16)).toEqual({ ok: false, field: "width", reason: "number" });
    expect(checkSize(Number.POSITIVE_INFINITY, 16)).toEqual({ ok: false, field: "width", reason: "number" });
  });

  it("reports the width before the height when both are wrong", () => {
    expect(checkSize(0, 0)).toEqual({ ok: false, field: "width", reason: "small" });
  });
});

describe("imagePath", () => {
  it("puts the picture in assets/ and makes it a .png", () => {
    expect(imagePath("my-image")).toBe("assets/my-image.png");
    expect(imagePath("  my-image  ")).toBe("assets/my-image.png");
    expect(imagePath("Hero.PNG")).toBe("assets/Hero.png");
    expect(imagePath("assets/hero")).toBe("assets/hero.png");
    expect(imagePath("assets/hero.png")).toBe("assets/hero.png");
    expect(imagePath("/assets/hero.png")).toBe("assets/hero.png");
    expect(imagePath("sprites\\hero")).toBe("assets/sprites/hero.png");
    expect(imagePath("小狐狸")).toBe("assets/小狐狸.png");
  });

  it("turns another picture extension into .png instead of stacking them", () => {
    expect(imagePath("photo.jpg")).toBe("assets/photo.png");
    expect(imagePath("photo.JPEG")).toBe("assets/photo.png");
  });

  it("refuses names that are empty, climb out of the project, or break file systems", () => {
    for (const bad of ["", "   ", "assets/", ".png", "assets/.png", "../x", "assets/../x", "a//b", "a?b", "a:b", 'a"b', "a|b", "a*b", "a<b", "a\u0001b"]) {
      expect(imagePath(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(imagePath("x".repeat(81))).toBeNull();
  });
});

describe("defaultImagePath", () => {
  it("is my-image.png, or the next free number so nothing is overwritten", () => {
    expect(defaultImagePath([])).toBe("assets/my-image.png");
    expect(defaultImagePath(["assets/my-image.png"])).toBe("assets/my-image-2.png");
    expect(defaultImagePath(["assets/my-image.png", "assets/my-image-2.png"])).toBe("assets/my-image-3.png");
    expect(defaultImagePath(["assets/player.png"])).toBe("assets/my-image.png");
  });
});

describe("fitScale", () => {
  it("picks the biggest whole-number zoom that fits, never below 1", () => {
    expect(fitScale(16, 16, 640, 640)).toBe(32);
    expect(fitScale(32, 32, 640, 320)).toBe(10);
    expect(fitScale(64, 64, 500, 900)).toBe(7);
    expect(fitScale(640, 360, 600, 400)).toBe(1);
    expect(fitScale(1000, 1000, 100, 100)).toBe(1);
  });

  it("caps the zoom and survives nonsense", () => {
    expect(fitScale(1, 1, 5000, 5000)).toBe(32);
    expect(fitScale(1, 1, 5000, 5000, 8)).toBe(8);
    expect(fitScale(0, 10, 100, 100)).toBe(1);
    expect(fitScale(10, 10, 0, 0)).toBe(1);
    expect(fitScale(10, 10, Number.NaN, 100)).toBe(1);
  });
});

describe("zoom", () => {
  it("steps through the zoom list and stops at both ends", () => {
    expect(stepZoom(8, 1)).toBe(10);
    expect(stepZoom(8, -1)).toBe(6);
    expect(stepZoom(ZOOMS[ZOOMS.length - 1], 1)).toBe(ZOOMS[ZOOMS.length - 1]);
    expect(stepZoom(1, -1)).toBe(1);
  });

  it("finds the nearest step when the zoom is not on the list", () => {
    expect(stepZoom(7, 1)).toBe(8);
    expect(stepZoom(7, -1)).toBe(6);
    expect(stepZoom(40, -1)).toBe(32);
  });

  it("opens at the biggest listed zoom that fits", () => {
    expect(startZoom(16, 16, 640, 640)).toBe(32);
    expect(startZoom(64, 64, 500, 900)).toBe(6);
    expect(startZoom(48, 48, 700, 700)).toBe(12);
    expect(startZoom(640, 360, 600, 400)).toBe(1);
  });
});

describe("canEditPixels", () => {
  it("is for PNG files only, wherever they are", () => {
    expect(canEditPixels("assets/player.png")).toBe(true);
    expect(canEditPixels("assets/Player.PNG")).toBe(true);
    expect(canEditPixels("hero.png")).toBe(true);
    for (const path of ["assets/photo.jpg", "assets/sound.wav", "main.py", "assets/png", "assets/.png", ".png"]) {
      expect(canEditPixels(path), path).toBe(false);
    }
  });
});

describe("limits", () => {
  it("lets existing pictures be a little bigger than new ones", () => {
    expect(MAX_EDIT_PIXELS).toBeGreaterThanOrEqual(640 * 360);
    expect(MAX_EDIT_PIXELS).toBeGreaterThan(MAX_NEW_SIDE * MAX_NEW_SIDE);
  });
});

describe("palette", () => {
  it("is a set of distinct, valid, opaque colours", () => {
    expect(PALETTE.length).toBeGreaterThanOrEqual(16);
    expect(new Set(PALETTE).size).toBe(PALETTE.length);
    for (const hex of PALETTE) expect(parseHex(hex), hex).not.toBeNull();
    for (const hex of PALETTE) expect(hex).toBe(hex.toLowerCase());
  });
});

describe("boardBudget", () => {
  it("keeps the tools beside the board on a wide screen", () => {
    expect(boardBudget(1400, 860)).toEqual({ width: 960, height: 600 });
    expect(boardBudget(1000, 700)).toEqual({ width: 640, height: 440 });
  });

  it("gives a phone nearly the whole width, and a square board", () => {
    expect(boardBudget(390, 844)).toEqual({ width: 334, height: 334 });
    expect(startZoom(32, 32, 334, 334)).toBe(10);
  });

  it("never goes below a usable box", () => {
    expect(boardBudget(320, 480)).toEqual({ width: 264, height: 160 });
    expect(boardBudget(100, 100)).toEqual({ width: 160, height: 160 });
  });
});
