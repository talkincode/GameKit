/**
 * Decides whether a map may be written, and what the project becomes.
 * Pure: the studio store does the durable write, after this plan succeeds.
 * A bad map never leaves a half-written CSV behind.
 */
import { type Project, normalizePath, removeFile, upsertFile } from "../project";
import { collisionCsvPath, layerCsvPath, mapDocumentPath, readMapFiles, slugFromDocumentPath, tilesetPath, writeMapFiles, type MapFiles } from "./document";
import { MAP_MODULE_PATH, mapShapeOk } from "./model";

export type MapSaveInput = {
  mode: "create" | "overwrite";
  /** Paths this map already owned. Overwrite may delete a layer CSV that left this list. */
  previousPaths: string[];
  documentPath: string;
  documentText: string;
  texts: { path: string; text: string }[];
  tilesetPath: string;
  tilesetPng: Uint8Array;
};

export type MapSaveFailure = "no-project" | "bad-path" | "taken" | "missing" | "bad-map" | "write-failed";

export type MapSavePlan =
  | { ok: true; documentPath: string; next: Project; removed: string[]; written: { path: string; text?: string; bytes?: Uint8Array }[] }
  | { ok: false; reason: Exclude<MapSaveFailure, "write-failed"> };

export function planMapSave(project: Project | null, openedFor: string | null, input: MapSaveInput): MapSavePlan {
  if (!project || !openedFor || project.id !== openedFor) return { ok: false, reason: "no-project" };
  const documentPath = normalizePath(input.documentPath);
  const slug = documentPath ? slugFromDocumentPath(documentPath) : null;
  if (!documentPath || !slug || documentPath !== mapDocumentPath(slug)) return { ok: false, reason: "bad-path" };
  const tileset = normalizePath(input.tilesetPath);
  if (!tileset || tileset !== tilesetPath(slug)) return { ok: false, reason: "bad-path" };
  const texts: { path: string; text: string }[] = [];
  for (const file of input.texts) {
    const path = normalizePath(file.path);
    if (!path || !path.startsWith(`maps/${slug}.`) || !path.endsWith(".csv")) return { ok: false, reason: "bad-path" };
    if (file.text.length > 80_000) return { ok: false, reason: "bad-map" };
    texts.push({ path, text: file.text });
  }
  const owned = new Set<string>([documentPath, tileset, ...texts.map((file) => file.path)]);
  const collision = collisionCsvPath(slug);
  if (!collision || !owned.has(collision)) return { ok: false, reason: "bad-map" };
  const draft = readMapFiles(
    [
      { path: documentPath, text: input.documentText },
      ...texts,
      { path: tileset, bytes: input.tilesetPng },
    ],
    documentPath,
  );
  if (!draft.ok || !mapShapeOk(draft.draft.map)) return { ok: false, reason: "bad-map" };
  const writtenFiles = writeMapFiles(draft.draft.map, input.tilesetPng);
  if (!writtenFiles || !sameFiles(writtenFiles, { documentPath, documentText: input.documentText, texts, tilesetPath: tileset, tilesetPng: input.tilesetPng })) {
    return { ok: false, reason: "bad-map" };
  }
  const exists = (path: string) => project.files.some((file) => file.path === path);
  if (input.mode === "create") {
    for (const path of owned) {
      if (exists(path)) return { ok: false, reason: "taken" };
    }
  } else if (!exists(documentPath)) {
    return { ok: false, reason: "missing" };
  }
  const previous = new Set(input.previousPaths.filter((path) => path.startsWith(`maps/${slug}.`)));
  if (input.mode === "overwrite") {
    for (const path of owned) {
      if (path === documentPath) continue;
      if (exists(path) && !previous.has(path)) return { ok: false, reason: "taken" };
    }
  }
  const removed = [...previous].filter((path) => !owned.has(path) && exists(path) && path.endsWith(".csv") && layerCsvPath(slug, path.split(".").at(-2) ?? "") === path);
  const written = [
    { path: documentPath, text: input.documentText },
    ...texts.map((file) => ({ path: file.path, text: file.text })),
    { path: tileset, bytes: input.tilesetPng },
  ];
  let next = project;
  for (const path of removed) next = removeFile(next, path);
  for (const file of written) next = upsertFile(next, file);
  return { ok: true, documentPath, next, removed, written };
}

function sameFiles(rebuilt: MapFiles, input: MapFiles): boolean {
  if (rebuilt.documentPath !== input.documentPath || rebuilt.documentText !== input.documentText) return false;
  if (rebuilt.tilesetPath !== input.tilesetPath || rebuilt.tilesetPng !== input.tilesetPng) return false;
  if (rebuilt.texts.length !== input.texts.length) return false;
  return rebuilt.texts.every((file, index) => file.path === input.texts[index]?.path && file.text === input.texts[index]?.text);
}

export type MapExampleInput = { moduleText: string; mainText?: string };

export type MapExampleResult =
  | { ok: true; changed: boolean; module: "wrote" | "kept" | "same"; main: boolean }
  | { ok: false; reason: "no-project" | "bad-path" | "write-failed" };

export type MapExamplePlan =
  | { ok: true; next: Project; changed: boolean; module: "wrote" | "kept" | "same"; main: boolean }
  | { ok: false; reason: "no-project" | "bad-path" };

/** Adds the visible pygame helper. Replaces main.py only when the child asked to try the map. */
export function planMapExample(project: Project | null, openedFor: string | null, input: MapExampleInput): MapExamplePlan {
  if (!project || !openedFor || project.id !== openedFor) return { ok: false, reason: "no-project" };
  if (!input.moduleText.trim() || input.moduleText.length > 20_000) return { ok: false, reason: "bad-path" };
  if (input.mainText !== undefined && (input.mainText.length > 20_000 || !input.mainText.includes("asyncio.sleep(0)"))) {
    return { ok: false, reason: "bad-path" };
  }
  let next = project;
  let changed = false;
  let module: "wrote" | "kept" | "same" = "same";
  const existing = project.files.find((file) => file.path === MAP_MODULE_PATH);
  if (existing?.bytes) return { ok: false, reason: "bad-path" };
  if (!existing) {
    next = upsertFile(next, { path: MAP_MODULE_PATH, text: input.moduleText });
    changed = true;
    module = "wrote";
  } else if (existing.text !== input.moduleText) {
    module = "kept";
  }
  let main = false;
  if (input.mainText !== undefined) {
    const currentMain = next.files.find((file) => file.path === "main.py");
    if (currentMain?.bytes) return { ok: false, reason: "bad-path" };
    if (currentMain?.text !== input.mainText) {
      next = upsertFile(next, { path: "main.py", text: input.mainText });
      changed = true;
      main = true;
    }
  }
  return { ok: true, next, changed, module, main };
}
