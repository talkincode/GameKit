/**
 * One editing session: the picture, its tools, the stroke in progress and the
 * undo history. The editor screen only forwards pointer positions and button
 * presses here, which keeps every drawing rule testable without a browser.
 */
import {
  type Pixels,
  type Rgba,
  type Stroke,
  TRANSPARENT,
  beginStroke,
  fillAt,
  finishStroke,
  paintAll,
  paintLine,
  readPixel,
} from "./buffer";
import { type History, createHistory, currentSerial, record, redo, undo } from "./history";

export type Tool = "pencil" | "eraser" | "fill" | "picker";

export type Session = {
  pixels: Pixels;
  history: History;
  stroke: Stroke | null;
  /** Where the pointer was at the last step of the stroke, possibly outside the picture. */
  last: [number, number] | null;
  /** The history serial that matches what is on disk. */
  savedSerial: number;
};

export type PointerResult = {
  /** Something under the pointer was painted. */
  changed: boolean;
  /** The picker found a colour (transparent counts). Undefined when it missed the picture. */
  picked?: Rgba;
};

export function createSession(pixels: Pixels): Session {
  const history = createHistory();
  return { pixels, history, stroke: null, last: null, savedSerial: currentSerial(history) };
}

function finish(session: Session): void {
  if (session.stroke) {
    const change = finishStroke(session.pixels, session.stroke, session.history.next);
    if (change) record(session.history, change);
  }
  session.stroke = null;
  session.last = null;
}

/** Closes any stroke in progress, so what is on the canvas is what is in the history. */
export function endStroke(session: Session): void {
  finish(session);
}

export function pointerDown(session: Session, tool: Tool, x: number, y: number, color: Rgba): PointerResult {
  finish(session);
  if (tool === "picker") {
    const picked = readPixel(session.pixels, x, y);
    return picked ? { changed: false, picked } : { changed: false };
  }
  const stroke = beginStroke();
  if (tool === "fill") {
    const count = fillAt(session.pixels, stroke, x, y, color);
    const change = finishStroke(session.pixels, stroke, session.history.next);
    if (change) record(session.history, change);
    return { changed: count > 0 };
  }
  session.stroke = stroke;
  paintLine(session.pixels, stroke, null, [x, y], tool === "eraser" ? TRANSPARENT : color);
  session.last = [x, y];
  return { changed: true };
}

export function pointerMove(session: Session, tool: Tool, x: number, y: number, color: Rgba): void {
  if (!session.stroke || (tool !== "pencil" && tool !== "eraser")) return;
  paintLine(session.pixels, session.stroke, session.last, [x, y], tool === "eraser" ? TRANSPARENT : color);
  session.last = [x, y];
}

export function pointerUp(session: Session): void {
  finish(session);
}

/** Wipes the picture to transparent as one undo step. False when there was nothing to wipe. */
export function clearAll(session: Session): boolean {
  finish(session);
  const stroke = beginStroke();
  paintAll(session.pixels, stroke, TRANSPARENT);
  const change = finishStroke(session.pixels, stroke, session.history.next);
  if (!change) return false;
  record(session.history, change);
  return true;
}

export function undoStep(session: Session): boolean {
  finish(session);
  return undo(session.history, session.pixels) !== null;
}

export function redoStep(session: Session): boolean {
  finish(session);
  return redo(session.history, session.pixels) !== null;
}

export function isDirty(session: Session): boolean {
  return currentSerial(session.history) !== session.savedSerial;
}

/** Call after the picture has been written, so closing no longer asks. */
export function markSaved(session: Session): void {
  finish(session);
  session.savedSerial = currentSerial(session.history);
}
