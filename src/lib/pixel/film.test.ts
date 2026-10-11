import { describe, expect, it } from "vitest";
import { type Rgba, createPixels, pixelsEqual, readPixel } from "./buffer";
import { decodePng, encodePng } from "./png";
import { framesFromDocument, parseSpriteAnim } from "./anim";
import {
  addBlankFrame,
  addLayer,
  clearActiveLayer,
  createFilm,
  deleteFrame,
  deleteLayer,
  displayFrame,
  duplicateFrame,
  exportFilm,
  filmDirty,
  filmFromImage,
  filmMarkSaved,
  filmPointerDown,
  filmPointerMove,
  filmPointerUp,
  filmRedo,
  filmUndo,
  moveLayer,
  replaceWithSheet,
  selectFrame,
  setFps,
  setFrameDuration,
  setLayerVisible,
  shiftPixels,
  toggleStateFrame,
} from "./film";

const ORANGE: Rgba = [239, 125, 87, 255];
const GREEN: Rgba = [56, 183, 100, 255];
const HALF: Rgba = [0, 0, 255, 128];

function draw(film: ReturnType<typeof createFilm>, x: number, y: number, color: Rgba = ORANGE) {
  filmPointerDown(film, "pencil", x, y, color);
  filmPointerUp(film);
}

describe("frames", () => {
  it("draws, undoes across frames, and does not dirty a saved film", () => {
    const film = createFilm(4, 4);
    expect(filmDirty(film)).toBe(false);
    draw(film, 1, 1);
    expect(readPixel(film.frames[0].layers[0].pixels, 1, 1)).toEqual(ORANGE);
    expect(filmUndo(film)).toBe(true);
    expect(readPixel(film.frames[0].layers[0].pixels, 1, 1)?.[3]).toBe(0);
    expect(filmRedo(film)).toBe(true);
    expect(readPixel(film.frames[0].layers[0].pixels, 1, 1)).toEqual(ORANGE);

    expect(addBlankFrame(film)).toBe(true);
    draw(film, 2, 2, GREEN);
    expect(readPixel(film.frames[0].layers[0].pixels, 2, 2)?.[3]).toBe(0);
    expect(readPixel(film.frames[1].layers[0].pixels, 2, 2)).toEqual(GREEN);
    expect(filmUndo(film)).toBe(true);
    expect(film.index).toBe(1);
    expect(readPixel(film.frames[1].layers[0].pixels, 2, 2)?.[3]).toBe(0);

    filmMarkSaved(film);
    expect(filmDirty(film)).toBe(false);
    draw(film, 0, 0);
    expect(filmDirty(film)).toBe(true);
  });

  it("renumbers states when a frame is inserted or removed, and keeps the last frame", () => {
    const film = createFilm(4, 4);
    addBlankFrame(film);
    addBlankFrame(film);
    selectFrame(film, 0);
    expect(toggleStateFrame(film, "walk")).toBe(true);
    selectFrame(film, 2);
    expect(toggleStateFrame(film, "walk")).toBe(true);
    expect(film.states.walk).toEqual([0, 2]);
    selectFrame(film, 0);
    expect(duplicateFrame(film)).toBe(true);
    expect(film.index).toBe(1);
    expect(film.states.walk).toEqual([0, 3]);
    expect(pixelsEqual(film.frames[1].layers[0].pixels, film.frames[0].layers[0].pixels)).toBe(true);
    selectFrame(film, 0);
    expect(deleteFrame(film)).toBe(true);
    expect(film.states.walk).toEqual([2]);
    while (film.frames.length > 1) expect(deleteFrame(film)).toBe(true);
    expect(deleteFrame(film)).toBe("last-frame");
    expect(film.frames).toHaveLength(1);
  });

  it("sets one duration or every duration from an fps, and refuses a bad number", () => {
    const film = createFilm(4, 4);
    addBlankFrame(film);
    expect(setFrameDuration(film, 1, 80)).toBe(true);
    expect(film.frames[1].durationMs).toBe(80);
    expect(film.frames[0].durationMs).toBe(125);
    expect(setFrameDuration(film, 1, 0)).toBe("size");
    expect(film.frames[1].durationMs).toBe(80);
    expect(setFps(film, 4)).toBe(true);
    expect(film.frames.map((frame) => frame.durationMs)).toEqual([250, 250]);
    expect(filmUndo(film)).toBe(true);
    expect(film.frames[1].durationMs).toBe(80);
  });

  it("refuses another frame when the picture is already large, and leaves it unchanged", () => {
    const film = filmFromImage(createPixels(200, 200));
    const before = film.frames.length;
    expect(addBlankFrame(film)).toBe("pixels");
    expect(film.frames).toHaveLength(before);
    expect(filmDirty(film)).toBe(false);
  });
});

describe("layers, selection, and sheets", () => {
  it("hides a layer, moves pixels, and undoes both", () => {
    const film = createFilm(6, 4);
    draw(film, 1, 1, ORANGE);
    expect(addLayer(film)).toBe(true);
    draw(film, 1, 1, GREEN);
    expect(readPixel(displayFrame(film, 0, false), 1, 1)).toEqual(GREEN);
    expect(setLayerVisible(film, 1, false)).toBe(true);
    expect(readPixel(displayFrame(film, 0, false), 1, 1)).toEqual(ORANGE);
    expect(filmUndo(film)).toBe(true);
    expect(readPixel(displayFrame(film, 0, false), 1, 1)).toEqual(GREEN);
    expect(moveLayer(film, -1)).toBe(true);
    expect(readPixel(displayFrame(film, 0, false), 1, 1)).toEqual(ORANGE);
    expect(deleteLayer(film)).toBe(true);
    expect(deleteLayer(film)).toBe("last-layer");

    filmPointerDown(film, "select", 0, 0, ORANGE);
    filmPointerMove(film, "select", 2, 2, ORANGE);
    filmPointerUp(film);
    expect(film.selection).toEqual({ x: 0, y: 0, w: 3, h: 3 });
    filmPointerDown(film, "select", 1, 1, ORANGE);
    filmPointerMove(film, "select", 4, 1, ORANGE);
    filmPointerUp(film);
    expect(readPixel(film.frames[0].layers[0].pixels, 1, 1)?.[3]).toBe(0);
    expect(readPixel(film.frames[0].layers[0].pixels, 4, 1)).toEqual(ORANGE);
    expect(filmUndo(film)).toBe(true);
    expect(readPixel(film.frames[0].layers[0].pixels, 1, 1)).toEqual(ORANGE);
    expect(readPixel(film.frames[0].layers[0].pixels, 4, 1)?.[3]).toBe(0);
  });

  it("moves a half-transparent pixel without changing its colour", () => {
    const origin = createPixels(4, 1);
    const at = 0;
    origin.data.set(HALF, at);
    const moved = shiftPixels(origin, { x: 0, y: 0, w: 1, h: 1 }, 2, 0);
    expect(readPixel(moved, 0, 0)?.[3]).toBe(0);
    expect(readPixel(moved, 2, 0)).toEqual(HALF);
  });

  it("imports a grid in a stable order and undo puts the old picture back", () => {
    const film = createFilm(2, 2);
    draw(film, 0, 0, ORANGE);
    const sheet = createPixels(4, 4);
    sheet.data.set(GREEN, 0);
    sheet.data.set(ORANGE, (2 * 4 + 3) * 4);
    expect(replaceWithSheet(film, sheet, 2, 2)).toBe(true);
    expect(film.frames).toHaveLength(4);
    expect(readPixel(film.frames[0].layers[0].pixels, 0, 0)).toEqual(GREEN);
    expect(readPixel(film.frames[3].layers[0].pixels, 1, 0)).toEqual(ORANGE);
    expect(filmUndo(film)).toBe(true);
    expect(film.width).toBe(2);
    expect(film.frames).toHaveLength(1);
    expect(readPixel(film.frames[0].layers[0].pixels, 0, 0)).toEqual(ORANGE);
    expect(replaceWithSheet(film, sheet, 3, 2)).toBe("fit");
    expect(film.frames).toHaveLength(1);
  });

  it("saves frames, durations, states, and alpha that open again as the same film", () => {
    const film = createFilm(2, 2);
    draw(film, 0, 1, HALF);
    addBlankFrame(film);
    draw(film, 1, 0, GREEN);
    setFrameDuration(film, 0, 200);
    setFrameDuration(film, 1, 80);
    selectFrame(film, 0);
    toggleStateFrame(film, "idle");
    selectFrame(film, 1);
    toggleStateFrame(film, "walk");
    expect(toggleStateFrame(film, "no spaces")).toBe("name");
    const exported = exportFilm(film, "assets/hero.png");
    expect(exported).not.toBeNull();
    if (!exported) return;
    const decoded = decodePng(encodePng(exported.sheet));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const parsed = parseSpriteAnim(exported.json, "assets/hero.png");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.animation.frames.map((item) => item.durationMs)).toEqual([200, 80]);
    expect(parsed.document.animation.states).toEqual({ idle: [0], walk: [1] });
    const opened = framesFromDocument(decoded.pixels, parsed.document);
    expect(readPixel(opened?.[0] as ReturnType<typeof createPixels>, 0, 1)).toEqual(HALF);
    expect(readPixel(opened?.[1] as ReturnType<typeof createPixels>, 1, 0)).toEqual(GREEN);
    expect(readPixel(opened?.[0] as ReturnType<typeof createPixels>, 1, 1)?.[3]).toBe(0);
  });

  it("clears only the active layer, as one undo step", () => {
    const film = createFilm(3, 3);
    draw(film, 1, 1);
    expect(addLayer(film)).toBe(true);
    draw(film, 0, 0, GREEN);
    expect(clearActiveLayer(film)).toBe(true);
    expect(readPixel(film.frames[0].layers[1].pixels, 0, 0)?.[3]).toBe(0);
    expect(readPixel(film.frames[0].layers[0].pixels, 1, 1)).toEqual(ORANGE);
    expect(filmUndo(film)).toBe(true);
    expect(readPixel(film.frames[0].layers[1].pixels, 0, 0)).toEqual(GREEN);
  });
});
