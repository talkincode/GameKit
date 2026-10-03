/**
 * One editing session: the tools, the strokes they make, undo, and "is there
 * anything unsaved?". The editor screen only forwards pointer positions here.
 */
import { describe, expect, it } from "vitest";
import { type Rgba, TRANSPARENT, createPixels, pixelsEqual, readPixel } from "./buffer";
import {
  clearAll,
  createSession,
  endStroke,
  isDirty,
  markSaved,
  pointerDown,
  pointerMove,
  pointerUp,
  redoStep,
  undoStep,
} from "./session";

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];

function drag(session: ReturnType<typeof createSession>, tool: "pencil" | "eraser", color: Rgba, path: [number, number][]) {
  pointerDown(session, tool, path[0][0], path[0][1], color);
  for (const [x, y] of path.slice(1)) pointerMove(session, tool, x, y, color);
  pointerUp(session);
}

describe("session", () => {
  it("starts clean", () => {
    const session = createSession(createPixels(8, 8));
    expect(isDirty(session)).toBe(false);
    expect(undoStep(session)).toBe(false);
  });

  it("draws a dot on press and a line on drag, with no gaps even when the pointer jumps", () => {
    const session = createSession(createPixels(16, 4));
    drag(session, "pencil", RED, [[0, 1], [15, 1]]);
    for (let x = 0; x < 16; x += 1) expect(readPixel(session.pixels, x, 1), `x=${x}`).toEqual(RED);
    expect(readPixel(session.pixels, 0, 0)).toEqual(TRANSPARENT);
  });

  it("makes one undo step per drag, not one per pixel", () => {
    const session = createSession(createPixels(16, 4));
    const blank = createPixels(16, 4);
    drag(session, "pencil", RED, [[0, 0], [3, 0], [6, 2], [9, 2]]);
    expect(undoStep(session)).toBe(true);
    expect(pixelsEqual(session.pixels, blank)).toBe(true);
    expect(undoStep(session)).toBe(false);
  });

  it("redoes what was undone, and drawing again throws the redo away", () => {
    const session = createSession(createPixels(8, 8));
    drag(session, "pencil", RED, [[1, 1], [1, 1]]);
    undoStep(session);
    expect(redoStep(session)).toBe(true);
    expect(readPixel(session.pixels, 1, 1)).toEqual(RED);
    undoStep(session);
    drag(session, "pencil", BLUE, [[2, 2], [2, 2]]);
    expect(redoStep(session)).toBe(false);
  });

  it("keeps drawing while the pointer is outside the picture and picks up the line when it comes back", () => {
    const session = createSession(createPixels(8, 8));
    drag(session, "pencil", RED, [[2, 2], [-5, 2], [4, 6]]);
    expect(readPixel(session.pixels, 0, 2)).toEqual(RED);
    expect(session.pixels.data.length).toBe(8 * 8 * 4);
    expect(readPixel(session.pixels, 4, 6)).toEqual(RED);
  });

  it("erases to transparent", () => {
    const session = createSession(createPixels(4, 4, RED));
    drag(session, "eraser", RED, [[1, 1], [2, 1]]);
    expect(readPixel(session.pixels, 1, 1)).toEqual(TRANSPARENT);
    expect(readPixel(session.pixels, 2, 1)).toEqual(TRANSPARENT);
    expect(readPixel(session.pixels, 3, 1)).toEqual(RED);
  });

  it("paints with transparent as a colour too", () => {
    const session = createSession(createPixels(4, 4, RED));
    drag(session, "pencil", TRANSPARENT, [[0, 0], [0, 0]]);
    expect(readPixel(session.pixels, 0, 0)).toEqual(TRANSPARENT);
  });

  it("fills in one step and does not carry on into a drag", () => {
    const session = createSession(createPixels(6, 6));
    const result = pointerDown(session, "fill", 2, 2, RED);
    expect(result.changed).toBe(true);
    pointerMove(session, "fill", 5, 5, RED);
    pointerUp(session);
    expect(readPixel(session.pixels, 0, 0)).toEqual(RED);
    expect(undoStep(session)).toBe(true);
    expect(readPixel(session.pixels, 0, 0)).toEqual(TRANSPARENT);
    expect(undoStep(session)).toBe(false);
  });

  it("does nothing when filling a colour onto itself", () => {
    const session = createSession(createPixels(4, 4, RED));
    const result = pointerDown(session, "fill", 1, 1, RED);
    expect(result.changed).toBe(false);
    expect(isDirty(session)).toBe(false);
    expect(undoStep(session)).toBe(false);
  });

  it("picks a colour without changing the picture", () => {
    const session = createSession(createPixels(4, 4));
    drag(session, "pencil", BLUE, [[3, 3], [3, 3]]);
    markSaved(session);
    expect(pointerDown(session, "picker", 3, 3, RED).picked).toEqual(BLUE);
    expect(pointerDown(session, "picker", 0, 0, RED).picked).toEqual(TRANSPARENT);
    expect(pointerDown(session, "picker", 99, 99, RED).picked).toBeUndefined();
    pointerUp(session);
    expect(isDirty(session)).toBe(false);
  });

  it("clears to transparent as an undoable step, and a blank picture clears to nothing", () => {
    const session = createSession(createPixels(4, 4));
    expect(clearAll(session)).toBe(false);
    drag(session, "pencil", RED, [[1, 1], [2, 2]]);
    const painted = new Uint8ClampedArray(session.pixels.data);
    expect(clearAll(session)).toBe(true);
    expect(readPixel(session.pixels, 1, 1)).toEqual(TRANSPARENT);
    undoStep(session);
    expect([...session.pixels.data]).toEqual([...painted]);
  });

  it("is dirty after a change, clean after saving, dirty again after undoing a saved change", () => {
    const session = createSession(createPixels(4, 4));
    drag(session, "pencil", RED, [[0, 0], [0, 0]]);
    expect(isDirty(session)).toBe(true);
    markSaved(session);
    expect(isDirty(session)).toBe(false);
    undoStep(session);
    expect(isDirty(session)).toBe(true);
    redoStep(session);
    expect(isDirty(session)).toBe(false);
    undoStep(session);
    drag(session, "pencil", BLUE, [[3, 3], [3, 3]]);
    expect(isDirty(session)).toBe(true);
  });

  it("is clean again when a drawn pixel is undone back to the start", () => {
    const session = createSession(createPixels(4, 4));
    drag(session, "pencil", RED, [[0, 0], [0, 0]]);
    undoStep(session);
    expect(isDirty(session)).toBe(false);
  });

  it("does not count painting a pixel the colour it already was", () => {
    const session = createSession(createPixels(4, 4, RED));
    drag(session, "pencil", RED, [[1, 1], [2, 2]]);
    expect(isDirty(session)).toBe(false);
  });

  it("undo during a stroke finishes the stroke first", () => {
    const session = createSession(createPixels(8, 1));
    pointerDown(session, "pencil", 0, 0, RED);
    pointerMove(session, "pencil", 3, 0, RED);
    expect(undoStep(session)).toBe(true);
    expect(readPixel(session.pixels, 3, 0)).toEqual(TRANSPARENT);
    pointerMove(session, "pencil", 5, 0, RED);
    expect(readPixel(session.pixels, 5, 0)).toEqual(TRANSPARENT);
  });

  it("endStroke closes an unfinished stroke so a save sees every pixel", () => {
    const session = createSession(createPixels(8, 1));
    pointerDown(session, "pencil", 0, 0, RED);
    pointerMove(session, "pencil", 2, 0, RED);
    endStroke(session);
    expect(isDirty(session)).toBe(true);
    markSaved(session);
    expect(isDirty(session)).toBe(false);
  });

  it("ignores moves when no stroke is open", () => {
    const session = createSession(createPixels(4, 4));
    pointerMove(session, "pencil", 2, 2, RED);
    expect(isDirty(session)).toBe(false);
    expect(readPixel(session.pixels, 2, 2)).toEqual(TRANSPARENT);
  });
});
