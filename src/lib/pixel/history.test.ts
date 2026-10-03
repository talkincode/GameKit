/**
 * Undo and redo for the pixel editor. Each step is a Change (the pixels a stroke
 * really altered), so going back and forth is exact. "Is it saved?" is a question
 * about serial numbers, which are never reused.
 */
import { describe, expect, it } from "vitest";
import { beginStroke, createPixels, finishStroke, paintAt, pixelsEqual, readPixel, clonePixels } from "./buffer";
import { createHistory, currentSerial, redo, record, undo } from "./history";

const RED = [255, 0, 0, 255] as const;

function paint(pixels: ReturnType<typeof createPixels>, history: ReturnType<typeof createHistory>, x: number, y: number) {
  const stroke = beginStroke();
  paintAt(pixels, stroke, x, y, RED);
  const change = finishStroke(pixels, stroke, history.next);
  if (change) record(history, change);
  return change;
}

describe("history", () => {
  it("starts empty at serial 0 and has nothing to undo or redo", () => {
    const pixels = createPixels(4, 4);
    const history = createHistory();
    expect(currentSerial(history)).toBe(0);
    expect(undo(history, pixels)).toBeNull();
    expect(redo(history, pixels)).toBeNull();
  });

  it("undoes and redoes a stroke exactly", () => {
    const pixels = createPixels(4, 4);
    const history = createHistory();
    const original = clonePixels(pixels);
    paint(pixels, history, 1, 1);
    const painted = clonePixels(pixels);
    expect(undo(history, pixels)).not.toBeNull();
    expect(pixelsEqual(pixels, original)).toBe(true);
    expect(redo(history, pixels)).not.toBeNull();
    expect(pixelsEqual(pixels, painted)).toBe(true);
  });

  it("forgets what could be redone as soon as something new is drawn", () => {
    const pixels = createPixels(4, 4);
    const history = createHistory();
    paint(pixels, history, 0, 0);
    paint(pixels, history, 1, 0);
    undo(history, pixels);
    paint(pixels, history, 2, 0);
    expect(redo(history, pixels)).toBeNull();
    expect(readPixel(pixels, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(readPixel(pixels, 2, 0)).toEqual(RED);
  });

  it("never reuses a serial, so a state that was left cannot be mistaken for the saved one", () => {
    const pixels = createPixels(4, 4);
    const history = createHistory();
    const first = paint(pixels, history, 0, 0);
    const savedAt = currentSerial(history);
    expect(savedAt).toBe(first?.serial);
    undo(history, pixels);
    const second = paint(pixels, history, 3, 3);
    expect(second?.serial).not.toBe(savedAt);
    expect(currentSerial(history)).not.toBe(savedAt);
  });

  it("returns to the same serial after undo then redo", () => {
    const pixels = createPixels(4, 4);
    const history = createHistory();
    paint(pixels, history, 0, 0);
    const saved = currentSerial(history);
    undo(history, pixels);
    expect(currentSerial(history)).toBe(0);
    redo(history, pixels);
    expect(currentSerial(history)).toBe(saved);
  });

  it("keeps only the newest steps when the limit is reached, and still knows where the start was", () => {
    const pixels = createPixels(8, 1);
    const history = createHistory(3);
    for (let x = 0; x < 5; x += 1) paint(pixels, history, x, 0);
    let undone = 0;
    while (undo(history, pixels)) undone += 1;
    expect(undone).toBe(3);
    // Two strokes can no longer be undone, and the serial must not claim "nothing changed".
    expect(currentSerial(history)).not.toBe(0);
    expect(readPixel(pixels, 0, 0)).toEqual(RED);
    expect(readPixel(pixels, 1, 0)).toEqual(RED);
    expect(readPixel(pixels, 2, 0)).toEqual([0, 0, 0, 0]);
  });
});
