/**
 * Editor undo. A step is a whole map plus the tileset bytes it was painted with.
 * The tileset buffer is shared until the child replaces the picture, so a stroke
 * only copies the number grids.
 */
import type { MapDraft } from "./document";
import { cloneMap, mapFingerprint } from "./model";

export const MAP_HISTORY_LIMIT = 30;

export type MapHistory = {
  past: MapDraft[];
  present: MapDraft;
  future: MapDraft[];
};

export function historyStart(draft: MapDraft): MapHistory {
  return { past: [], present: draft, future: [] };
}

export function historyPush(history: MapHistory, next: MapDraft): MapHistory {
  if (sameDraft(history.present, next)) return history;
  return {
    past: [...history.past, cloneDraft(history.present)].slice(-MAP_HISTORY_LIMIT),
    present: next,
    future: [],
  };
}

export function historyUndo(history: MapHistory): MapHistory | null {
  const previous = history.past.at(-1);
  if (!previous) return null;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function historyRedo(history: MapHistory): MapHistory | null {
  const next = history.future[0];
  if (!next) return null;
  return {
    past: [...history.past, history.present].slice(-MAP_HISTORY_LIMIT),
    present: next,
    future: history.future.slice(1),
  };
}

export function cloneDraft(draft: MapDraft): MapDraft {
  return { map: cloneMap(draft.map), tileset: draft.tileset, tilesetPng: draft.tilesetPng };
}

function sameDraft(a: MapDraft, b: MapDraft): boolean {
  return a.tilesetPng === b.tilesetPng && mapFingerprint(a.map) === mapFingerprint(b.map);
}
