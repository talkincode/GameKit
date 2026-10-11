/**
 * The animation being drawn: several frames, each a stack of layers, plus the
 * action states. Drawing still uses the pixel buffer's strokes. Undo has to
 * remember which frame and layer changed, so it keeps its own stack on top of
 * those strokes. A structural change (add a frame, move a layer) stores a copy
 * of the small sprite instead.
 */
import {
  type AnimStateMap,
  type FrameSource,
  DEFAULT_DURATION_MS,
  MAX_ANIM_FRAMES,
  MAX_ANIM_LAYERS,
  MAX_ANIM_PIXELS,
  buildSpriteDocument,
  clampDuration,
  durationForFps,
  onionSkin,
  packedPixel,
  splitGrid,
  compositeLayers,
} from "./anim";
import {
  type Change,
  type Pixels,
  type Rgba,
  type Stroke,
  TRANSPARENT,
  applyChange,
  beginStroke,
  clonePixels,
  createPixels,
  fillAt,
  finishStroke,
  paintAll,
  paintLine,
  readPixel,
} from "./buffer";
import type { Tool } from "./session";

export type FilmTool = Tool | "select";

export type Rect = { x: number; y: number; w: number; h: number };

export type FilmLayer = { name: string; visible: boolean; pixels: Pixels };

export type FilmFrame = { durationMs: number; name?: string; layers: FilmLayer[] };

export type FilmLimit = "frames" | "pixels" | "layers" | "last-frame" | "last-layer" | "size" | "fit" | "name";

type Snapshot = {
  width: number;
  height: number;
  frames: FilmFrame[];
  states: AnimStateMap;
  index: number;
  layer: number;
  selection: Rect | null;
};

type DrawDrag = { kind: "draw"; stroke: Stroke; last: [number, number] };
type SelectDrag = { kind: "select"; anchor: [number, number] };
type MoveDrag = { kind: "move"; origin: Pixels; start: [number, number]; selection: Rect };

type FilmStep =
  | {
      kind: "pixels";
      serial: number;
      frame: number;
      layer: number;
      change: Change;
      selectionBefore: Rect | null;
      selectionAfter: Rect | null;
    }
  | { kind: "structure"; serial: number; before: Snapshot; after: Snapshot };

type FilmHistory = {
  done: FilmStep[];
  undone: FilmStep[];
  next: number;
  floor: number;
  budget: number;
};

const HISTORY_BUDGET = 8_000_000;

export type FilmSession = {
  width: number;
  height: number;
  frames: FilmFrame[];
  index: number;
  layer: number;
  states: AnimStateMap;
  selection: Rect | null;
  drag: DrawDrag | SelectDrag | MoveDrag | null;
  history: FilmHistory;
  savedSerial: number;
};

const STATE_NAME = /^[\w\u4e00-\u9fff-]{1,16}$/u;

export function createFilm(width: number, height: number, fill: Rgba = TRANSPARENT): FilmSession {
  return {
    width,
    height,
    frames: [blankFrame(width, height, DEFAULT_DURATION_MS, fill)],
    index: 0,
    layer: 0,
    states: {},
    selection: null,
    drag: null,
    history: { done: [], undone: [], next: 1, floor: 0, budget: HISTORY_BUDGET },
    savedSerial: 0,
  };
}

/** One picture becomes one frame. A saved note can replace that with the real frames. */
export function filmFromImage(pixels: Pixels): FilmSession {
  const film = createFilm(pixels.width, pixels.height);
  film.frames = [frameFromPixels(pixels, DEFAULT_DURATION_MS)];
  return film;
}

export function filmFromSaved(
  frames: Pixels[],
  meta: { durations: number[]; names: (string | undefined)[]; states: AnimStateMap },
): FilmSession | null {
  const first = frames[0];
  if (!first || frames.some((frame) => frame.width !== first.width || frame.height !== first.height)) return null;
  const film = createFilm(first.width, first.height);
  film.frames = frames.map((pixels, index) => frameFromPixels(pixels, meta.durations[index] ?? DEFAULT_DURATION_MS, meta.names[index]));
  film.states = cloneStates(meta.states);
  return film;
}

export function filmDirty(film: FilmSession): boolean {
  return filmSerial(film) !== film.savedSerial;
}

export function filmMarkSaved(film: FilmSession): void {
  endDrag(film);
  film.savedSerial = filmSerial(film);
}

export function filmCanUndo(film: FilmSession): boolean {
  return film.history.done.length > 0;
}

export function filmCanRedo(film: FilmSession): boolean {
  return film.history.undone.length > 0;
}

function filmSerial(film: FilmSession): number {
  const last = film.history.done[film.history.done.length - 1];
  return last ? last.serial : film.history.floor;
}

export function filmPointerDown(film: FilmSession, tool: FilmTool, x: number, y: number, color: Rgba): { changed: boolean; picked?: Rgba } {
  endDrag(film);
  const layer = activeLayer(film);
  if (!layer) return { changed: false };
  if (tool === "picker") {
    const picked = readPixel(shownFrame(film, film.index), x, y);
    return picked ? { changed: false, picked } : { changed: false };
  }
  if (tool === "select") {
    if (film.selection && hits(film.selection, x, y)) {
      film.drag = { kind: "move", origin: clonePixels(layer.pixels), start: [x, y], selection: { ...film.selection } };
      return { changed: false };
    }
    const anchor = clampCell(x, y, film.width, film.height);
    film.selection = { x: anchor[0], y: anchor[1], w: 1, h: 1 };
    film.drag = { kind: "select", anchor };
    return { changed: false };
  }
  const stroke = beginStroke();
  if (tool === "fill") {
    const count = fillAt(layer.pixels, stroke, x, y, color);
    const change = finishStroke(layer.pixels, stroke, film.history.next);
    if (change) recordPixels(film, change);
    return { changed: count > 0 };
  }
  film.drag = { kind: "draw", stroke, last: [x, y] };
  paintLine(layer.pixels, stroke, null, [x, y], tool === "eraser" ? TRANSPARENT : color);
  return { changed: true };
}

export function filmPointerMove(film: FilmSession, tool: FilmTool, x: number, y: number, color: Rgba): void {
  const drag = film.drag;
  if (!drag) return;
  if (drag.kind === "draw" && (tool === "pencil" || tool === "eraser")) {
    const layer = activeLayer(film);
    if (!layer) return;
    paintLine(layer.pixels, drag.stroke, drag.last, [x, y], tool === "eraser" ? TRANSPARENT : color);
    drag.last = [x, y];
    return;
  }
  if (drag.kind === "select") {
    film.selection = rectBetween(drag.anchor, [x, y], film.width, film.height);
    return;
  }
  if (drag.kind === "move") applyMove(film, drag, x, y);
}

export function filmPointerUp(film: FilmSession): void {
  endDrag(film);
}

export function clearActiveLayer(film: FilmSession): boolean {
  endDrag(film);
  const layer = activeLayer(film);
  if (!layer) return false;
  const stroke = beginStroke();
  paintAll(layer.pixels, stroke, TRANSPARENT);
  const change = finishStroke(layer.pixels, stroke, film.history.next);
  if (!change) return false;
  recordPixels(film, change);
  return true;
}

export function filmUndo(film: FilmSession): boolean {
  endDrag(film);
  const step = film.history.done.pop();
  if (!step) return false;
  if (step.kind === "pixels") {
    const layer = film.frames[step.frame]?.layers[step.layer];
    if (!layer) {
      film.history.done.push(step);
      return false;
    }
    applyChange(layer.pixels, step.change, "before");
    film.index = step.frame;
    film.layer = step.layer;
    film.selection = cloneRect(step.selectionBefore);
  } else {
    restore(film, step.before);
  }
  film.history.undone.push(step);
  return true;
}

export function filmRedo(film: FilmSession): boolean {
  endDrag(film);
  const step = film.history.undone.pop();
  if (!step) return false;
  if (step.kind === "pixels") {
    const layer = film.frames[step.frame]?.layers[step.layer];
    if (!layer) {
      film.history.undone.push(step);
      return false;
    }
    applyChange(layer.pixels, step.change, "after");
    film.index = step.frame;
    film.layer = step.layer;
    film.selection = cloneRect(step.selectionAfter);
  } else {
    restore(film, step.after);
  }
  film.history.done.push(step);
  return true;
}

export function selectFrame(film: FilmSession, index: number): void {
  endDrag(film);
  if (!Number.isInteger(index) || index < 0 || index >= film.frames.length) return;
  film.index = index;
  film.layer = Math.min(film.layer, film.frames[index].layers.length - 1);
  film.selection = null;
}

export function addBlankFrame(film: FilmSession): true | FilmLimit {
  return insertFrame(film, false);
}

export function duplicateFrame(film: FilmSession): true | FilmLimit {
  return insertFrame(film, true);
}

export function deleteFrame(film: FilmSession): true | FilmLimit {
  if (film.frames.length <= 1) return "last-frame";
  endDrag(film);
  const before = snapshot(film);
  const removed = film.index;
  film.frames.splice(removed, 1);
  film.states = remapStates(film.states, (index) => {
    if (index === removed) return null;
    return index > removed ? index - 1 : index;
  });
  film.index = Math.min(removed, film.frames.length - 1);
  film.layer = 0;
  film.selection = null;
  recordStructure(film, before);
  return true;
}

export function setFrameDuration(film: FilmSession, index: number, durationMs: number): true | FilmLimit {
  const duration = clampDuration(durationMs);
  if (duration === null) return "size";
  const frame = film.frames[index];
  if (!frame) return "size";
  if (frame.durationMs === duration) return true;
  endDrag(film);
  const before = snapshot(film);
  frame.durationMs = duration;
  recordStructure(film, before);
  return true;
}

export function setFps(film: FilmSession, fps: number): true | FilmLimit {
  const duration = durationForFps(fps);
  if (duration === null) return "size";
  if (film.frames.every((frame) => frame.durationMs === duration)) return true;
  endDrag(film);
  const before = snapshot(film);
  for (const frame of film.frames) frame.durationMs = duration;
  recordStructure(film, before);
  return true;
}

export function setFrameName(film: FilmSession, index: number, name: string): true | FilmLimit {
  const frame = film.frames[index];
  if (!frame) return "name";
  const trimmed = name.trim();
  if (trimmed.length > 16) return "name";
  if ((frame.name ?? "") === trimmed) return true;
  endDrag(film);
  const before = snapshot(film);
  if (trimmed) frame.name = trimmed;
  else delete frame.name;
  recordStructure(film, before);
  return true;
}

/** Adds the current frame to a state, or takes it out when it is already there. */
export function toggleStateFrame(film: FilmSession, name: string): true | FilmLimit {
  const trimmed = name.trim();
  if (!STATE_NAME.test(trimmed)) return "name";
  endDrag(film);
  const before = snapshot(film);
  const current = film.states[trimmed] ?? [];
  const next = current.includes(film.index) ? current.filter((index) => index !== film.index) : [...current, film.index];
  if (next.length) film.states = { ...film.states, [trimmed]: next };
  else {
    const rest = { ...film.states };
    delete rest[trimmed];
    film.states = rest;
  }
  recordStructure(film, before);
  return true;
}

export function addLayer(film: FilmSession): true | FilmLimit {
  const frame = film.frames[film.index];
  if (!frame) return "layers";
  if (frame.layers.length >= MAX_ANIM_LAYERS) return "layers";
  if (layerPixels(film) + film.width * film.height > 1024 * 1024) return "pixels";
  endDrag(film);
  const before = snapshot(film);
  frame.layers.push({ name: `图层 ${frame.layers.length + 1}`, visible: true, pixels: createPixels(film.width, film.height) });
  film.layer = frame.layers.length - 1;
  film.selection = null;
  recordStructure(film, before);
  return true;
}

export function deleteLayer(film: FilmSession): true | FilmLimit {
  const frame = film.frames[film.index];
  if (!frame || frame.layers.length <= 1) return "last-layer";
  endDrag(film);
  const before = snapshot(film);
  frame.layers.splice(film.layer, 1);
  film.layer = Math.min(film.layer, frame.layers.length - 1);
  film.selection = null;
  recordStructure(film, before);
  return true;
}

export function moveLayer(film: FilmSession, direction: -1 | 1): true | FilmLimit {
  const frame = film.frames[film.index];
  if (!frame) return "layers";
  const target = film.layer + direction;
  if (target < 0 || target >= frame.layers.length) return "layers";
  endDrag(film);
  const before = snapshot(film);
  const [layer] = frame.layers.splice(film.layer, 1);
  frame.layers.splice(target, 0, layer);
  film.layer = target;
  recordStructure(film, before);
  return true;
}

export function selectLayer(film: FilmSession, index: number): void {
  const frame = film.frames[film.index];
  if (!frame || !Number.isInteger(index) || index < 0 || index >= frame.layers.length) return;
  endDrag(film);
  film.layer = index;
}

export function setLayerVisible(film: FilmSession, index: number, visible: boolean): boolean {
  const layer = film.frames[film.index]?.layers[index];
  if (!layer || layer.visible === visible) return false;
  endDrag(film);
  const before = snapshot(film);
  layer.visible = visible;
  recordStructure(film, before);
  return true;
}

export function replaceWithSheet(film: FilmSession, sheet: Pixels, frameWidth: number, frameHeight: number): true | FilmLimit {
  const frames = splitGrid(sheet, frameWidth, frameHeight);
  if (!frames) {
    if (!Number.isInteger(frameWidth) || !Number.isInteger(frameHeight) || frameWidth < 1 || frameHeight < 1 || frameWidth > 256 || frameHeight > 256) {
      return "size";
    }
    if (sheet.width % frameWidth !== 0 || sheet.height % frameHeight !== 0) return "fit";
    const count = (sheet.width / frameWidth) * (sheet.height / frameHeight);
    if (count > MAX_ANIM_FRAMES) return "frames";
    return "pixels";
  }
  endDrag(film);
  const before = snapshot(film);
  film.width = frameWidth;
  film.height = frameHeight;
  film.frames = frames.map((pixels) => frameFromPixels(pixels, DEFAULT_DURATION_MS));
  film.index = 0;
  film.layer = 0;
  film.states = {};
  film.selection = null;
  recordStructure(film, before);
  return true;
}

/** What the canvas should show. A single visible layer is returned as-is so the pixels stay exact. */
export function displayFrame(film: FilmSession, frameIndex: number, onion: boolean): Pixels {
  const current = shownFrame(film, frameIndex);
  if (!onion || frameIndex <= 0) return current;
  const previous = shownFrame(film, frameIndex - 1);
  return onionSkin(current, previous);
}

export function exportFilm(film: FilmSession, imagePath: string): ReturnType<typeof buildSpriteDocument> {
  endDrag(film);
  const frames: FrameSource[] = film.frames.map((frame) => ({
    pixels: compositeLayers(frame.layers),
    durationMs: frame.durationMs,
    name: frame.name,
  }));
  return buildSpriteDocument(imagePath, frames, film.states);
}

/** A plain still picture does not grow a note. An existing note is rewritten so it cannot describe the wrong frames. */
export function filmNeedsSidecar(film: FilmSession, sidecarAlreadyThere: boolean): boolean {
  if (sidecarAlreadyThere) return true;
  if (film.frames.length !== 1) return true;
  if (Object.keys(film.states).length > 0) return true;
  const frame = film.frames[0];
  if (frame.name) return true;
  if (frame.durationMs !== DEFAULT_DURATION_MS) return true;
  if (frame.layers.length !== 1) return true;
  return false;
}

function insertFrame(film: FilmSession, copy: boolean): true | FilmLimit {
  if (film.frames.length >= MAX_ANIM_FRAMES) return "frames";
  if ((film.frames.length + 1) * film.width * film.height > MAX_ANIM_PIXELS) return "pixels";
  endDrag(film);
  const before = snapshot(film);
  const source = film.frames[film.index];
  const created = copy ? cloneFrame(source) : blankFrame(film.width, film.height, source.durationMs);
  const at = film.index + 1;
  film.frames.splice(at, 0, created);
  film.states = remapStates(film.states, (index) => (index >= at ? index + 1 : index));
  film.index = at;
  film.layer = 0;
  film.selection = null;
  recordStructure(film, before);
  return true;
}

function shownFrame(film: FilmSession, frameIndex: number): Pixels {
  const frame = film.frames[frameIndex] ?? film.frames[0];
  const visible = frame.layers.filter((layer) => layer.visible);
  if (visible.length === 1) return visible[0].pixels;
  return compositeLayers(frame.layers);
}

function activeLayer(film: FilmSession): FilmLayer | null {
  return film.frames[film.index]?.layers[film.layer] ?? null;
}

function blankFrame(width: number, height: number, durationMs: number, fill: Rgba = TRANSPARENT): FilmFrame {
  return { durationMs, layers: [{ name: "图层 1", visible: true, pixels: createPixels(width, height, fill) }] };
}

function frameFromPixels(pixels: Pixels, durationMs: number, name?: string): FilmFrame {
  const frame: FilmFrame = { durationMs, layers: [{ name: "图层 1", visible: true, pixels: clonePixels(pixels) }] };
  if (name?.trim()) frame.name = name.trim();
  return frame;
}

function cloneFrame(frame: FilmFrame): FilmFrame {
  return {
    durationMs: frame.durationMs,
    ...(frame.name ? { name: frame.name } : {}),
    layers: frame.layers.map((layer) => ({ name: layer.name, visible: layer.visible, pixels: clonePixels(layer.pixels) })),
  };
}

function cloneStates(states: AnimStateMap): AnimStateMap {
  return Object.fromEntries(Object.entries(states).map(([name, indices]) => [name, [...indices]]));
}

function cloneRect(rect: Rect | null): Rect | null {
  return rect ? { ...rect } : null;
}

function snapshot(film: FilmSession): Snapshot {
  return {
    width: film.width,
    height: film.height,
    frames: film.frames.map(cloneFrame),
    states: cloneStates(film.states),
    index: film.index,
    layer: film.layer,
    selection: cloneRect(film.selection),
  };
}

function restore(film: FilmSession, snap: Snapshot): void {
  film.width = snap.width;
  film.height = snap.height;
  film.frames = snap.frames.map(cloneFrame);
  film.states = cloneStates(snap.states);
  film.index = Math.min(snap.index, film.frames.length - 1);
  film.layer = Math.min(snap.layer, film.frames[film.index].layers.length - 1);
  film.selection = cloneRect(snap.selection);
}

function remapStates(states: AnimStateMap, mapIndex: (index: number) => number | null): AnimStateMap {
  const next: AnimStateMap = {};
  for (const [name, indices] of Object.entries(states)) {
    const mapped: number[] = [];
    for (const index of indices) {
      const value = mapIndex(index);
      if (value !== null) mapped.push(value);
    }
    if (mapped.length) next[name] = mapped;
  }
  return next;
}

function layerPixels(film: FilmSession): number {
  return film.frames.reduce((sum, frame) => sum + frame.layers.length * film.width * film.height, 0);
}

function endDrag(film: FilmSession): void {
  const drag = film.drag;
  film.drag = null;
  if (!drag) return;
  const layer = activeLayer(film);
  if (!layer) return;
  if (drag.kind === "draw") {
    const change = finishStroke(layer.pixels, drag.stroke, film.history.next);
    if (change) recordPixels(film, change);
    return;
  }
  if (drag.kind === "move") {
    const change = diffPixels(drag.origin, layer.pixels, film.history.next);
    if (change) recordPixels(film, change, drag.selection, film.selection);
  }
}

function recordPixels(film: FilmSession, change: Change, selectionBefore = film.selection, selectionAfter = film.selection): void {
  push(film, {
    kind: "pixels",
    serial: change.serial,
    frame: film.index,
    layer: film.layer,
    change,
    selectionBefore: cloneRect(selectionBefore),
    selectionAfter: cloneRect(selectionAfter),
  });
}

function recordStructure(film: FilmSession, before: Snapshot): void {
  push(film, { kind: "structure", serial: film.history.next, before, after: snapshot(film) });
}

function push(film: FilmSession, step: FilmStep): void {
  const history = film.history;
  history.done.push(step);
  history.undone = [];
  history.next = step.serial + 1;
  let cost = history.done.reduce((sum, item) => sum + stepCost(item), 0);
  while (history.done.length > 1 && (history.done.length > 80 || cost > history.budget)) {
    const oldest = history.done.shift();
    if (!oldest) break;
    cost -= stepCost(oldest);
    history.floor = oldest.serial;
  }
}

function stepCost(step: FilmStep): number {
  if (step.kind === "pixels") return step.change.indices.length * 8;
  return snapshotBytes(step.before) + snapshotBytes(step.after);
}

function snapshotBytes(snap: Snapshot): number {
  let total = 0;
  for (const frame of snap.frames) {
    for (const layer of frame.layers) total += layer.pixels.data.length;
  }
  return total;
}

function applyMove(film: FilmSession, drag: MoveDrag, x: number, y: number): void {
  const layer = activeLayer(film);
  if (!layer) return;
  const dx = x - drag.start[0];
  const dy = y - drag.start[1];
  layer.pixels.data.set(shiftPixels(drag.origin, drag.selection, dx, dy).data);
  film.selection = { x: drag.selection.x + dx, y: drag.selection.y + dy, w: drag.selection.w, h: drag.selection.h };
}

export function shiftPixels(origin: Pixels, selection: Rect, dx: number, dy: number): Pixels {
  const next = clonePixels(origin);
  for (let y = 0; y < selection.h; y += 1) {
    for (let x = 0; x < selection.w; x += 1) {
      const sx = selection.x + x;
      const sy = selection.y + y;
      if (sx < 0 || sy < 0 || sx >= origin.width || sy >= origin.height) continue;
      writePixel(next, sx, sy, TRANSPARENT);
    }
  }
  for (let y = 0; y < selection.h; y += 1) {
    for (let x = 0; x < selection.w; x += 1) {
      const sx = selection.x + x;
      const sy = selection.y + y;
      const color = readPixel(origin, sx, sy);
      if (!color) continue;
      const tx = sx + dx;
      const ty = sy + dy;
      if (tx < 0 || ty < 0 || tx >= next.width || ty >= next.height) continue;
      writePixel(next, tx, ty, color);
    }
  }
  return next;
}

function writePixel(pixels: Pixels, x: number, y: number, color: Rgba): void {
  const at = (y * pixels.width + x) * 4;
  if (color[3] === 0) {
    pixels.data[at] = 0;
    pixels.data[at + 1] = 0;
    pixels.data[at + 2] = 0;
    pixels.data[at + 3] = 0;
    return;
  }
  pixels.data[at] = color[0];
  pixels.data[at + 1] = color[1];
  pixels.data[at + 2] = color[2];
  pixels.data[at + 3] = color[3];
}

function diffPixels(before: Pixels, after: Pixels, serial: number): Change | null {
  const indices: number[] = [];
  const was: number[] = [];
  const now: number[] = [];
  const count = before.width * before.height;
  for (let index = 0; index < count; index += 1) {
    const oldPacked = packedPixel(before, index);
    const newPacked = packedPixel(after, index);
    if (oldPacked === newPacked) continue;
    indices.push(index);
    was.push(oldPacked);
    now.push(newPacked);
  }
  if (!indices.length) return null;
  return { serial, indices: Uint32Array.from(indices), before: Uint32Array.from(was), after: Uint32Array.from(now) };
}

function hits(selection: Rect, x: number, y: number): boolean {
  return x >= selection.x && y >= selection.y && x < selection.x + selection.w && y < selection.y + selection.h;
}

function clampCell(x: number, y: number, width: number, height: number): [number, number] {
  return [Math.max(0, Math.min(width - 1, x)), Math.max(0, Math.min(height - 1, y))];
}

function rectBetween(anchor: [number, number], point: [number, number], width: number, height: number): Rect {
  const start = clampCell(anchor[0], anchor[1], width, height);
  const end = clampCell(point[0], point[1], width, height);
  const x = Math.min(start[0], end[0]);
  const y = Math.min(start[1], end[1]);
  return { x, y, w: Math.abs(end[0] - start[0]) + 1, h: Math.abs(end[1] - start[1]) + 1 };
}
