/**
 * A map on disk is ordinary files, all under `maps/<slug>.`:
 *
 * - `<slug>.map.json` — size, tileset, layer names, spawn, objects
 * - `<slug>.<layer>.csv` — one layer of tile indexes
 * - `<slug>.collision.csv` — 0 walk, 1 solid
 * - `<slug>.tileset.png` — the palette image
 *
 * Paths inside the JSON must be these paths. A file that points at `main.py`
 * is rejected, so opening or saving a map cannot rewrite unrelated work.
 * A bundle is the same files in one JSON, for export and import.
 */
import { bytesToBase64, base64ToBytes } from "../project";
import { decodePng } from "../pixel/png";
import type { Pixels } from "../pixel/buffer";
import { readGrid, writeGrid } from "./csv";
import {
  MAP_BUNDLE_FORMAT,
  MAP_FORMAT,
  type MapLayer,
  type MapObject,
  type TileMap,
  cleanMapName,
  cloneMap,
  isLayerId,
  isMapSlug,
  mapShapeOk,
  tileCount,
} from "./model";

export const DOCUMENT_CAP = 200_000;
export const BUNDLE_CAP = 2_000_000;
export const PNG_CAP = 1_000_000;

export type MapReadError =
  | "not-json"
  | "format"
  | "size"
  | "background"
  | "tileset"
  | "layer"
  | "csv"
  | "collision"
  | "spawn"
  | "objects"
  | "png"
  | "too-big";

export type MapFileBlob = { path: string; text?: string; bytes?: Uint8Array };

export type MapFileText = { path: string; text: string };

export type MapFiles = {
  documentPath: string;
  documentText: string;
  texts: MapFileText[];
  tilesetPath: string;
  tilesetPng: Uint8Array;
};

export type MapDraft = {
  map: TileMap;
  tileset: Pixels;
  tilesetPng: Uint8Array;
};

type Loose = Record<string, unknown>;

export function mapDocumentPath(slug: string): string | null {
  if (!isMapSlug(slug)) return null;
  return `maps/${slug}.map.json`;
}

export function slugFromDocumentPath(path: string): string | null {
  const match = /^maps\/([a-z0-9]+(?:-[a-z0-9]+)*)\.map\.json$/.exec(path);
  const slug = match?.[1];
  return slug && isMapSlug(slug) ? slug : null;
}

export function isMapDocument(path: string): boolean {
  return slugFromDocumentPath(path) !== null;
}

/** Files the child paints. The assistant may read them and must not rewrite them. */
export function isMapDataPath(path: string): boolean {
  return path.endsWith(".map.json") || path.endsWith(".tileset.png") || (path.startsWith("maps/") && path.endsWith(".csv"));
}

export function layerCsvPath(slug: string, layerId: string): string | null {
  if (!isMapSlug(slug) || !isLayerId(layerId)) return null;
  return `maps/${slug}.${layerId}.csv`;
}

export function collisionCsvPath(slug: string): string | null {
  if (!isMapSlug(slug)) return null;
  return `maps/${slug}.collision.csv`;
}

export function tilesetPath(slug: string): string | null {
  if (!isMapSlug(slug)) return null;
  return `maps/${slug}.tileset.png`;
}

export function pathsOf(map: TileMap): string[] | null {
  const document = mapDocumentPath(map.slug);
  const tileset = tilesetPath(map.slug);
  const collision = collisionCsvPath(map.slug);
  if (!document || !tileset || !collision) return null;
  const layers: string[] = [];
  for (const layer of map.layers) {
    const path = layerCsvPath(map.slug, layer.id);
    if (!path) return null;
    layers.push(path);
  }
  return [document, tileset, collision, ...layers];
}

export function writeMapFiles(map: TileMap, tilesetPng: Uint8Array): MapFiles | null {
  if (!mapShapeOk(map) || tilesetPng.byteLength < 8 || tilesetPng.byteLength > PNG_CAP) return null;
  const documentPath = mapDocumentPath(map.slug);
  const image = tilesetPath(map.slug);
  const collisionPath = collisionCsvPath(map.slug);
  if (!documentPath || !image || !collisionPath) return null;
  const collision = writeGrid(map.collision, map.columns, map.rows);
  if (!collision) return null;
  const texts: MapFileText[] = [{ path: collisionPath, text: collision }];
  const layers: Loose[] = [];
  for (const layer of map.layers) {
    const path = layerCsvPath(map.slug, layer.id);
    const csv = writeGrid(layer.cells, map.columns, map.rows);
    if (!path || !csv) return null;
    texts.push({ path, text: csv });
    layers.push({ id: layer.id, name: layer.name, visible: layer.visible, csv: path });
  }
  const document = {
    format: MAP_FORMAT,
    formatVersion: 1,
    name: map.name,
    tileWidth: map.tileWidth,
    tileHeight: map.tileHeight,
    columns: map.columns,
    rows: map.rows,
    background: map.background,
    tileset: {
      image,
      columns: map.tilesetColumns,
      rows: map.tilesetRows,
      tileWidth: map.tileWidth,
      tileHeight: map.tileHeight,
    },
    layers,
    collision: collisionPath,
    spawn: { tileX: map.spawn.tileX, tileY: map.spawn.tileY },
    objects: map.objects.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      tileX: item.tileX,
      tileY: item.tileY,
    })),
  };
  const documentText = `${JSON.stringify(document, null, 2)}\n`;
  if (documentText.length > DOCUMENT_CAP) return null;
  return { documentPath, documentText, texts, tilesetPath: image, tilesetPng };
}

export function readMapFiles(
  files: { path: string; text?: string; bytes?: Uint8Array }[],
  documentPath: string,
): { ok: true; draft: MapDraft } | { ok: false; reason: MapReadError } {
  const slug = slugFromDocumentPath(documentPath);
  if (!slug) return { ok: false, reason: "format" };
  const documentText = files.find((file) => file.path === documentPath)?.text;
  if (typeof documentText !== "string") return { ok: false, reason: "not-json" };
  if (documentText.length > DOCUMENT_CAP) return { ok: false, reason: "too-big" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(documentText);
  } catch {
    return { ok: false, reason: "not-json" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "not-json" };
  const record = parsed as Loose;
  if (record.format !== MAP_FORMAT || record.formatVersion !== 1) return { ok: false, reason: "format" };
  const name = typeof record.name === "string" ? cleanMapName(record.name) : null;
  if (!name) return { ok: false, reason: "format" };
  const columns = record.columns;
  const rows = record.rows;
  const tileWidth = record.tileWidth;
  const tileHeight = record.tileHeight;
  if (!isInt(columns) || !isInt(rows) || !isInt(tileWidth) || !isInt(tileHeight)) return { ok: false, reason: "size" };
  const background = typeof record.background === "string" ? record.background.trim().toLowerCase() : "";
  if (!/^#[0-9a-f]{6}$/.test(background)) return { ok: false, reason: "background" };
  const tileset = record.tileset;
  if (!tileset || typeof tileset !== "object") return { ok: false, reason: "tileset" };
  const sheet = tileset as Loose;
  const image = tilesetPath(slug);
  if (!image || sheet.image !== image || sheet.tileWidth !== tileWidth || sheet.tileHeight !== tileHeight) {
    return { ok: false, reason: "tileset" };
  }
  if (!isInt(sheet.columns) || !isInt(sheet.rows)) return { ok: false, reason: "tileset" };
  const tilesetColumns = sheet.columns as number;
  const tilesetRows = sheet.rows as number;
  const count = tilesetColumns * tilesetRows;
  if (tilesetColumns < 1 || tilesetRows < 1 || count > 32) return { ok: false, reason: "tileset" };
  if (!Array.isArray(record.layers) || record.layers.length < 1) return { ok: false, reason: "layer" };
  const layers: MapLayer[] = [];
  for (const item of record.layers) {
    if (!item || typeof item !== "object") return { ok: false, reason: "layer" };
    const layer = item as Loose;
    if (typeof layer.id !== "string" || typeof layer.name !== "string" || typeof layer.csv !== "string") {
      return { ok: false, reason: "layer" };
    }
    const csvPath = layerCsvPath(slug, layer.id);
    if (!csvPath || layer.csv !== csvPath || typeof layer.visible !== "boolean") return { ok: false, reason: "layer" };
    const text = files.find((file) => file.path === csvPath)?.text;
    if (typeof text !== "string") return { ok: false, reason: "csv" };
    const cells = readGrid(text, columns as number, rows as number, count);
    if (!cells) return { ok: false, reason: "csv" };
    layers.push({ id: layer.id, name: layer.name, visible: layer.visible, cells });
  }
  const collisionPath = collisionCsvPath(slug);
  if (!collisionPath || record.collision !== collisionPath) return { ok: false, reason: "collision" };
  const collisionText = files.find((file) => file.path === collisionPath)?.text;
  if (typeof collisionText !== "string") return { ok: false, reason: "collision" };
  const collision = readGrid(collisionText, columns as number, rows as number, 1);
  if (!collision) return { ok: false, reason: "collision" };
  const spawn = readSpawn(record.spawn);
  if (!spawn) return { ok: false, reason: "spawn" };
  const objects = readObjects(record.objects);
  if (!objects) return { ok: false, reason: "objects" };
  const png = files.find((file) => file.path === image)?.bytes;
  if (!png || png.byteLength > PNG_CAP) return { ok: false, reason: "png" };
  const decoded = decodePng(png, tilesetColumns * tileWidth * tilesetRows * tileHeight);
  if (!decoded.ok) return { ok: false, reason: "png" };
  if (decoded.pixels.width !== tilesetColumns * tileWidth || decoded.pixels.height !== tilesetRows * tileHeight) {
    return { ok: false, reason: "png" };
  }
  const map: TileMap = {
    name,
    slug,
    tileWidth: tileWidth as number,
    tileHeight: tileHeight as number,
    columns: columns as number,
    rows: rows as number,
    background,
    tilesetColumns,
    tilesetRows,
    layers,
    collision,
    spawn,
    objects,
  };
  if (!mapShapeOk(map)) return { ok: false, reason: "format" };
  if (tileCount(map) !== count) return { ok: false, reason: "tileset" };
  return { ok: true, draft: { map, tileset: decoded.pixels, tilesetPng: png } };
}

function readSpawn(value: unknown): { tileX: number; tileY: number } | null {
  if (!value || typeof value !== "object") return null;
  const spawn = value as Loose;
  if (!isInt(spawn.tileX) || !isInt(spawn.tileY)) return null;
  return { tileX: spawn.tileX as number, tileY: spawn.tileY as number };
}

function readObjects(value: unknown): MapObject[] | null {
  if (!Array.isArray(value)) return null;
  const objects: MapObject[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const object = item as Loose;
    if (typeof object.id !== "string" || typeof object.name !== "string" || typeof object.kind !== "string") return null;
    if (!isInt(object.tileX) || !isInt(object.tileY)) return null;
    objects.push({
      id: object.id,
      name: object.name,
      kind: object.kind,
      tileX: object.tileX as number,
      tileY: object.tileY as number,
    });
  }
  return objects;
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** One JSON the child can download and later import. Same files as the project copy. */
export function exportBundle(draft: MapDraft): string | null {
  const files = writeMapFiles(draft.map, draft.tilesetPng);
  if (!files) return null;
  const body = {
    format: MAP_BUNDLE_FORMAT,
    formatVersion: 1,
    files: [
      { path: files.documentPath, text: files.documentText },
      ...files.texts.map((file) => ({ path: file.path, text: file.text })),
      { path: files.tilesetPath, base64: bytesToBase64(files.tilesetPng) },
    ],
  };
  const text = `${JSON.stringify(body)}\n`;
  if (text.length > BUNDLE_CAP) return null;
  return text;
}

export function importBundle(text: string): { ok: true; draft: MapDraft } | { ok: false; reason: MapReadError } {
  if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "not-json" };
  if (text.length > BUNDLE_CAP) return { ok: false, reason: "too-big" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not-json" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "not-json" };
  const record = parsed as Loose;
  if (record.format !== MAP_BUNDLE_FORMAT || record.formatVersion !== 1 || !Array.isArray(record.files)) {
    return { ok: false, reason: "format" };
  }
  const files: { path: string; text?: string; bytes?: Uint8Array }[] = [];
  let documentPath = "";
  for (const item of record.files) {
    if (!item || typeof item !== "object") return { ok: false, reason: "format" };
    const file = item as Loose;
    if (typeof file.path !== "string" || !isMapDataPath(file.path)) return { ok: false, reason: "format" };
    if (typeof file.text === "string") {
      if (file.path.endsWith(".map.json")) {
        if (documentPath) return { ok: false, reason: "format" };
        documentPath = file.path;
      }
      files.push({ path: file.path, text: file.text });
    } else if (typeof file.base64 === "string") {
      let bytes: Uint8Array;
      try {
        bytes = base64ToBytes(file.base64);
      } catch {
        return { ok: false, reason: "png" };
      }
      files.push({ path: file.path, bytes });
    } else {
      return { ok: false, reason: "format" };
    }
  }
  if (!documentPath) return { ok: false, reason: "format" };
  return readMapFiles(files, documentPath);
}

/** Keep the painted map, store it under the map the child currently has open. */
export function retargetDraft(draft: MapDraft, slug: string): MapDraft | null {
  if (!isMapSlug(slug)) return null;
  return { map: { ...cloneMap(draft.map), slug }, tileset: draft.tileset, tilesetPng: draft.tilesetPng };
}
