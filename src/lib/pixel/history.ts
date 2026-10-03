/**
 * Undo and redo for the pixel editor. Each step is a `Change`, so going back and
 * forth is exact and cheap. Serial numbers are never reused, which is what makes
 * "does the picture differ from what was saved?" a simple comparison.
 * A step costs memory in proportion to the pixels it changed, so the history is
 * capped by that too: a few whole-canvas fills must not hold the tab's memory hostage.
 */
import { type Change, type Pixels, applyChange } from "./buffer";

export type History = {
  done: Change[];
  undone: Change[];
  limit: number;
  /** The most changed pixels the history may hold; the newest step is always kept. */
  budget: number;
  /** The serial the next change should carry. */
  next: number;
  /** Serial of the newest step that fell off the end; the oldest state still reachable. */
  floor: number;
};

export const PIXEL_BUDGET = 4_000_000;

export function createHistory(limit = 200, budget = PIXEL_BUDGET): History {
  return { done: [], undone: [], limit, budget, next: 1, floor: 0 };
}

function held(history: History): number {
  let total = 0;
  for (const change of history.done) total += change.indices.length;
  return total;
}

/** Adds a finished stroke. Anything that could have been redone is gone. */
export function record(history: History, change: Change): void {
  history.done.push(change);
  history.undone.length = 0;
  history.next = Math.max(history.next, change.serial + 1);
  let size = held(history);
  while (history.done.length > 1 && (history.done.length > history.limit || size > history.budget)) {
    const oldest = history.done.shift() as Change;
    size -= oldest.indices.length;
    history.floor = oldest.serial;
  }
}

/** The serial of the picture as it is now. */
export function currentSerial(history: History): number {
  return history.done.length ? history.done[history.done.length - 1].serial : history.floor;
}

export function undo(history: History, pixels: Pixels): Change | null {
  const change = history.done.pop();
  if (!change) return null;
  applyChange(pixels, change, "before");
  history.undone.push(change);
  return change;
}

export function redo(history: History, pixels: Pixels): Change | null {
  const change = history.undone.pop();
  if (!change) return null;
  applyChange(pixels, change, "after");
  history.done.push(change);
  return change;
}
