/**
 * A tile map the child can paint: layers of tile indexes, a collision grid,
 * one spawn cell, and object markers.
 *
 * Indexes are ordinary numbers. 0 is empty. 1 is the first cell of the tileset,
 * left to right then top to bottom. Nothing here touches the project or the DOM.
 */
export const MAP_FORMAT = "gamekit.map" as const;
export const MAP_BUNDLE_FORMAT = "gamekit.map-bundle" as const;
export const MAP_MODULE_PATH = "map_loader.py";

export const MIN_COLUMNS = 4;
export const MIN_ROWS = 4;
export const MAX_COLUMNS = 40;
export const MAX_ROWS = 24;
export const MAX_LAYERS = 4;
export const MAX_OBJECTS = 32;
export const MAX_TILES = 32;
export const MAX_NAME = 24;
export const TILE_SIZES = [8, 16, 32] as const;

export const MAP_PRESETS = [
  { id: "small", columns: 10, rows: 8 },
  { id: "medium", columns: 20, rows: 12 },
  { id: "large", columns: 32, rows: 18 },
] as const;

/** Layer ids are also the CSV file suffix, so they must not collide with `collision`. */
export const LAYER_SLOTS = [
  { id: "ground", name: "地面" },
  { id: "decor", name: "装饰" },
  { id: "front", name: "前景" },
  { id: "top", name: "顶层" },
] as const;

export const OBJECT_KINDS = [
  { id: "coin", name: "金币" },
  { id: "enemy", name: "敌人" },
  { id: "door", name: "门" },
  { id: "mark", name: "标记" },
] as const;

export const BACKGROUNDS = [
  { id: "sky", name: "天空", color: "#87ceeb" },
  { id: "night", name: "夜晚", color: "#1b1e2b" },
  { id: "cave", name: "洞穴", color: "#3a332c" },
  { id: "sand", name: "沙滩", color: "#f6e2b3" },
] as const;

/** First cell is tile 1. Colours are opaque so pygame can sample the centre. */
export const STARTER_TILES = [
  { id: "grass", name: "草地", color: "#38b764" },
  { id: "dirt", name: "泥土", color: "#b86f50" },
  { id: "stone", name: "石头", color: "#5a6988" },
  { id: "water", name: "水面", color: "#3b5dc9" },
  { id: "sand", name: "沙子", color: "#f4d35e" },
  { id: "wood", name: "木头", color: "#a26d3d" },
  { id: "brick", name: "砖块", color: "#e4572e" },
  { id: "flower", name: "小花", color: "#ef7d57" },
] as const;

export const DEFAULT_BACKGROUND = BACKGROUNDS[0].color;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LAYER_ID_RE = /^[a-z][a-z0-9-]{0,16}$/;
const OBJECT_ID_RE = /^[a-z][a-z0-9-]{0,16}$/;

export type MapLayer = {
  id: string;
  name: string;
  visible: boolean;
  cells: number[];
};

export type MapObject = {
  id: string;
  name: string;
  kind: string;
  tileX: number;
  tileY: number;
};

export type TileMap = {
  name: string;
  slug: string;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  background: string;
  tilesetColumns: number;
  tilesetRows: number;
  layers: MapLayer[];
  collision: number[];
  spawn: { tileX: number; tileY: number };
  objects: MapObject[];
};

export function isMapSlug(value: string): boolean {
  return value.length >= 1 && value.length <= 40 && SLUG_RE.test(value);
}

export function isTileSize(value: number): value is (typeof TILE_SIZES)[number] {
  return (TILE_SIZES as readonly number[]).includes(value);
}

export function cleanMapName(input: string): string | null {
  const name = input.trim();
  if (!name || name.length > MAX_NAME || /[\u0000-\u001f]/.test(name)) return null;
  return name;
}

export function isLayerId(value: string): boolean {
  return value !== "collision" && LAYER_ID_RE.test(value);
}

export function tileCount(map: Pick<TileMap, "tilesetColumns" | "tilesetRows">): number {
  return map.tilesetColumns * map.tilesetRows;
}

export function inMap(map: Pick<TileMap, "columns" | "rows">, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.columns && y < map.rows;
}

export function cellAt(cells: number[], columns: number, x: number, y: number): number | null {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return null;
  const index = y * columns + x;
  return index >= 0 && index < cells.length ? cells[index] : null;
}

export function emptyGrid(columns: number, rows: number): number[] {
  return Array.from({ length: columns * rows }, () => 0);
}

export function cloneMap(map: TileMap): TileMap {
  return {
    ...map,
    layers: map.layers.map((layer) => ({ ...layer, cells: layer.cells.slice() })),
    collision: map.collision.slice(),
    objects: map.objects.map((item) => ({ ...item })),
    spawn: { ...map.spawn },
  };
}

/** Content only. The file slug is a path, not part of what a round-trip compares. */
export function mapFingerprint(map: TileMap): string {
  const layers = map.layers.map((layer) => `${layer.id}:${layer.name}:${layer.visible ? 1 : 0}:${layer.cells.join(",")}`).join("|");
  const objects = map.objects.map((item) => `${item.id}:${item.kind}:${item.name}@${item.tileX},${item.tileY}`).join("|");
  return [
    map.name,
    map.tileWidth,
    map.tileHeight,
    map.columns,
    map.rows,
    map.background,
    map.tilesetColumns,
    map.tilesetRows,
    `${map.spawn.tileX},${map.spawn.tileY}`,
    map.collision.join(","),
    objects,
    layers,
  ].join(";");
}

export function solidCount(map: TileMap): number {
  return map.collision.reduce((sum, cell) => sum + (cell === 1 ? 1 : 0), 0);
}

export function createMap(input: {
  slug: string;
  name: string;
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  tilesetColumns?: number;
  tilesetRows?: number;
}): TileMap | null {
  const name = cleanMapName(input.name);
  if (!name || !isMapSlug(input.slug)) return null;
  if (!Number.isInteger(input.columns) || !Number.isInteger(input.rows)) return null;
  if (input.columns < MIN_COLUMNS || input.rows < MIN_ROWS || input.columns > MAX_COLUMNS || input.rows > MAX_ROWS) return null;
  if (!isTileSize(input.tileWidth) || input.tileHeight !== input.tileWidth) return null;
  const tilesetColumns = input.tilesetColumns ?? 4;
  const tilesetRows = input.tilesetRows ?? 2;
  if (!Number.isInteger(tilesetColumns) || !Number.isInteger(tilesetRows)) return null;
  if (tilesetColumns < 1 || tilesetRows < 1 || tilesetColumns * tilesetRows > MAX_TILES) return null;
  const ground = LAYER_SLOTS[0];
  return {
    name,
    slug: input.slug,
    tileWidth: input.tileWidth,
    tileHeight: input.tileHeight,
    columns: input.columns,
    rows: input.rows,
    background: DEFAULT_BACKGROUND,
    tilesetColumns,
    tilesetRows,
    layers: [{ id: ground.id, name: ground.name, visible: true, cells: emptyGrid(input.columns, input.rows) }],
    collision: emptyGrid(input.columns, input.rows),
    spawn: { tileX: 1, tileY: Math.max(0, input.rows - 2) },
    objects: [],
  };
}

export function nextMapSlug(taken: string[], base: string): string | null {
  if (!isMapSlug(base)) return null;
  if (!taken.includes(base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const slug = `${base}-${index}`;
    if (isMapSlug(slug) && !taken.includes(slug)) return slug;
  }
  return null;
}

function replaceLayer(map: TileMap, index: number, layer: MapLayer): TileMap {
  const layers = map.layers.slice();
  layers[index] = layer;
  return { ...map, layers };
}

export function paintLayer(map: TileMap, layerIndex: number, points: readonly (readonly [number, number])[], tile: number): TileMap | null {
  const layer = map.layers[layerIndex];
  if (!layer || !Number.isInteger(tile) || tile < 0 || tile > tileCount(map)) return null;
  const cells = layer.cells.slice();
  let changed = false;
  for (const [x, y] of points) {
    if (!inMap(map, x, y)) continue;
    const index = y * map.columns + x;
    if (cells[index] === tile) continue;
    cells[index] = tile;
    changed = true;
  }
  if (!changed) return null;
  return replaceLayer(map, layerIndex, { ...layer, cells });
}

export function fillLayer(map: TileMap, layerIndex: number, x: number, y: number, tile: number): TileMap | null {
  const layer = map.layers[layerIndex];
  if (!layer || !inMap(map, x, y) || !Number.isInteger(tile) || tile < 0 || tile > tileCount(map)) return null;
  const filled = flood(layer.cells, map.columns, map.rows, x, y, tile, tileCount(map));
  if (!filled) return null;
  return replaceLayer(map, layerIndex, { ...layer, cells: filled });
}

export function paintCollision(map: TileMap, points: readonly (readonly [number, number])[], solid: 0 | 1): TileMap | null {
  if (solid !== 0 && solid !== 1) return null;
  const cells = map.collision.slice();
  let changed = false;
  for (const [x, y] of points) {
    if (!inMap(map, x, y)) continue;
    const index = y * map.columns + x;
    if (cells[index] === solid) continue;
    cells[index] = solid;
    changed = true;
  }
  if (!changed) return null;
  return { ...map, collision: cells };
}

export function fillCollision(map: TileMap, x: number, y: number, solid: 0 | 1): TileMap | null {
  if ((solid !== 0 && solid !== 1) || !inMap(map, x, y)) return null;
  const filled = flood(map.collision, map.columns, map.rows, x, y, solid, 1);
  if (!filled) return null;
  return { ...map, collision: filled };
}

/**
 * Recolours one connected area (no diagonals). Null when nothing changes.
 * Each cell is expanded once, so the walk cannot loop.
 */
function flood(cells: number[], columns: number, rows: number, x: number, y: number, value: number, maxValue: number): number[] | null {
  const start = cells[y * columns + x];
  if (start === undefined || start === value || value < 0 || value > maxValue) return null;
  const next = cells.slice();
  const seen = new Uint8Array(columns * rows);
  const stack: [number, number][] = [[x, y]];
  let filled = 0;
  while (stack.length) {
    const [cx, cy] = stack.pop() as [number, number];
    if (cx < 0 || cy < 0 || cx >= columns || cy >= rows) continue;
    const index = cy * columns + cx;
    if (seen[index] || next[index] !== start) continue;
    seen[index] = 1;
    next[index] = value;
    filled += 1;
    if (filled > columns * rows) return null;
    stack.push([cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]);
  }
  return next;
}

export function setSpawn(map: TileMap, x: number, y: number): TileMap | null {
  if (!inMap(map, x, y)) return null;
  if (map.spawn.tileX === x && map.spawn.tileY === y) return null;
  return { ...map, spawn: { tileX: x, tileY: y } };
}

export function toggleObject(map: TileMap, x: number, y: number, kind: string): TileMap | null {
  if (!inMap(map, x, y)) return null;
  const existing = map.objects.findIndex((item) => item.tileX === x && item.tileY === y);
  if (existing >= 0) {
    return { ...map, objects: map.objects.filter((_, index) => index !== existing) };
  }
  const spec = OBJECT_KINDS.find((item) => item.id === kind);
  if (!spec || map.objects.length >= MAX_OBJECTS) return null;
  const id = nextObjectId(map, spec.id);
  if (!id) return null;
  return { ...map, objects: [...map.objects, { id, name: spec.name, kind: spec.id, tileX: x, tileY: y }] };
}

function nextObjectId(map: TileMap, kind: string): string | null {
  for (let index = 1; index < 100; index += 1) {
    const id = `${kind}-${index}`;
    if (OBJECT_ID_RE.test(id) && !map.objects.some((item) => item.id === id)) return id;
  }
  return null;
}

export function setBackground(map: TileMap, color: string): TileMap | null {
  const next = color.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(next) || next === map.background) return null;
  return { ...map, background: next };
}

export function addLayer(map: TileMap): TileMap | null {
  if (map.layers.length >= MAX_LAYERS) return null;
  const slot = LAYER_SLOTS.find((item) => !map.layers.some((layer) => layer.id === item.id));
  if (!slot) return null;
  return {
    ...map,
    layers: [...map.layers, { id: slot.id, name: slot.name, visible: true, cells: emptyGrid(map.columns, map.rows) }],
  };
}

export function deleteLayer(map: TileMap, index: number): TileMap | null {
  if (map.layers.length <= 1 || !map.layers[index]) return null;
  return { ...map, layers: map.layers.filter((_, at) => at !== index) };
}

export function moveLayer(map: TileMap, index: number, direction: -1 | 1): TileMap | null {
  const target = index + direction;
  if (!map.layers[index] || target < 0 || target >= map.layers.length) return null;
  const layers = map.layers.slice();
  const [layer] = layers.splice(index, 1);
  layers.splice(target, 0, layer);
  return { ...map, layers };
}

export function setLayerVisible(map: TileMap, index: number, visible: boolean): TileMap | null {
  const layer = map.layers[index];
  if (!layer || layer.visible === visible) return null;
  return replaceLayer(map, index, { ...layer, visible });
}

export function renameLayer(map: TileMap, index: number, name: string): TileMap | null {
  const layer = map.layers[index];
  const next = name.trim();
  if (!layer || !next || next.length > 8 || next === layer.name || /[\u0000-\u001f]/.test(next)) return null;
  return replaceLayer(map, index, { ...layer, name: next });
}

export function rectPoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const points: [number, number][] = [];
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) points.push([x, y]);
  }
  return points;
}

/** Structural checks shared by the editor and the file reader. */
export function mapShapeOk(map: TileMap): boolean {
  if (!cleanMapName(map.name) || !isMapSlug(map.slug)) return false;
  if (!Number.isInteger(map.columns) || !Number.isInteger(map.rows)) return false;
  if (map.columns < MIN_COLUMNS || map.rows < MIN_ROWS || map.columns > MAX_COLUMNS || map.rows > MAX_ROWS) return false;
  if (!isTileSize(map.tileWidth) || map.tileHeight !== map.tileWidth) return false;
  if (!/^#[0-9a-f]{6}$/.test(map.background)) return false;
  if (!Number.isInteger(map.tilesetColumns) || !Number.isInteger(map.tilesetRows)) return false;
  const count = tileCount(map);
  if (map.tilesetColumns < 1 || map.tilesetRows < 1 || count > MAX_TILES) return false;
  if (map.layers.length < 1 || map.layers.length > MAX_LAYERS) return false;
  const ids = new Set<string>();
  for (const layer of map.layers) {
    if (!isLayerId(layer.id) || ids.has(layer.id)) return false;
    ids.add(layer.id);
    if (!layer.name.trim() || layer.name.length > 8) return false;
    if (!gridOk(layer.cells, map.columns, map.rows, count)) return false;
  }
  if (!gridOk(map.collision, map.columns, map.rows, 1)) return false;
  if (!inMap(map, map.spawn.tileX, map.spawn.tileY)) return false;
  if (map.objects.length > MAX_OBJECTS) return false;
  const objectIds = new Set<string>();
  const spots = new Set<string>();
  for (const item of map.objects) {
    if (!OBJECT_ID_RE.test(item.id) || objectIds.has(item.id)) return false;
    if (!OBJECT_KINDS.some((kind) => kind.id === item.kind)) return false;
    if (!item.name.trim() || item.name.length > 8) return false;
    if (!inMap(map, item.tileX, item.tileY)) return false;
    const spot = `${item.tileX},${item.tileY}`;
    if (spots.has(spot)) return false;
    objectIds.add(item.id);
    spots.add(spot);
  }
  return true;
}

function gridOk(cells: number[], columns: number, rows: number, max: number): boolean {
  if (cells.length !== columns * rows) return false;
  return cells.every((cell) => Number.isInteger(cell) && cell >= 0 && cell <= max);
}
