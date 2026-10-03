/**
 * Undo and redo for the pixel editor. Each step is a `Change`, so going back and
 * forth is exact and cheap. Serial numbers are never reused, which is what makes
 * "does the picture differ from what was saved?" a simple comparison.
 */
import { type Change, type Pixels, applyChange } from "./buffer";

export type History = {
  done: Change[];
  undone: Change[];
  limit: number;
  /** The serial the next change should carry. */
  next: number;
  /** Serial of the newest step that fell off the end; the oldest state still reachable. */
  floor: number;
};

export function createHistory(limit = 200): History {
  return { done: [], undone: [], limit, next: 1, floor: 0 };
}

/** Adds a finished stroke. Anything that could have been redone is gone. */
export function record(history: History, change: Change): void {
  history.done.push(change);
  history.undone.length = 0;
  history.next = Math.max(history.next, change.serial + 1);
  while (history.done.length > history.limit) {
    history.floor = (history.done.shift() as Change).serial;
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
