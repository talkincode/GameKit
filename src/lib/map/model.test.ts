import { describe, expect, it } from "vitest";
import { linePoints } from "../pixel/buffer";
import { encodePng } from "../pixel/png";
import { readGrid, writeGrid } from "./csv";
import { historyPush, historyRedo, historyStart, historyUndo, MAP_HISTORY_LIMIT } from "./history";
import {
  addLayer,
  createMap,
  deleteLayer,
  fillCollision,
  fillLayer,
  mapFingerprint,
  moveLayer,
  nextMapSlug,
  paintCollision,
  paintLayer,
  rectPoints,
  setBackground,
  setSpawn,
  solidCount,
  toggleObject,
} from "./model";
import { starterCenter, starterTileset } from "./tileset";

function level() {
  const map = createMap({ slug: "level-1", name: "第一关", columns: 10, rows: 8, tileWidth: 16, tileHeight: 16 });
  if (!map) throw new Error("map");
  return map;
}

describe("painting a map", () => {
  it("paints a cell, a rectangle, a fill, and an erase", () => {
    const map = level();
    const painted = paintLayer(map, 0, [[2, 3]], 1);
    expect(painted?.layers[0].cells[3 * 10 + 2]).toBe(1);
    const block = paintLayer(painted ?? map, 0, rectPoints(4, 3, 5, 4), 2);
    expect(block?.layers[0].cells[3 * 10 + 4]).toBe(2);
    expect(block?.layers[0].cells[4 * 10 + 5]).toBe(2);
    const erased = paintLayer(block ?? map, 0, [[4, 3]], 0);
    expect(erased?.layers[0].cells[3 * 10 + 4]).toBe(0);
    const filled = fillLayer(erased ?? map, 0, 0, 0, 3);
    expect(filled?.layers[0].cells[0]).toBe(3);
    expect(filled?.layers[0].cells[3 * 10 + 2]).toBe(1);
    expect(filled?.layers[0].cells.filter((cell) => cell === 2)).toHaveLength(3);
    expect(fillLayer(filled ?? map, 0, 2, 3, 1)).toBeNull();
  });

  it("stops a fill at the edge of the grid", () => {
    const map = level();
    const filled = fillCollision(map, 0, 0, 1);
    expect(filled && solidCount(filled)).toBe(80);
    expect(fillCollision(filled ?? map, 1, 1, 1)).toBeNull();
    expect(paintCollision(map, [[-1, 0], [9, 7]], 1)?.collision[7 * 10 + 9]).toBe(1);
  });

  it("rejects a tile the sheet does not have", () => {
    expect(paintLayer(level(), 0, [[0, 0]], 9)).toBeNull();
    expect(paintLayer(level(), 3, [[0, 0]], 1)).toBeNull();
  });

  it("places one spawn, collision, and an object marker", () => {
    const map = level();
    expect(map.spawn).toEqual({ tileX: 1, tileY: 6 });
    const spawned = setSpawn(map, 2, 7);
    expect(spawned?.spawn).toEqual({ tileX: 2, tileY: 7 });
    expect(setSpawn(map, 20, 0)).toBeNull();
    const solid = paintCollision(map, [[2, 3], [3, 3]], 1);
    expect(solid && solidCount(solid)).toBe(2);
    const marked = toggleObject(map, 4, 5, "coin");
    expect(marked?.objects).toEqual([{ id: "coin-1", name: "金币", kind: "coin", tileX: 4, tileY: 5 }]);
    expect(toggleObject(marked ?? map, 4, 5, "enemy")?.objects).toEqual([]);
    expect(toggleObject(map, 4, 5, "dragon")).toBeNull();
  });

  it("keeps layers in order and will not drop the last one", () => {
    const map = level();
    const two = addLayer(map);
    expect(two?.layers.map((layer) => layer.name)).toEqual(["地面", "装饰"]);
    const raised = two ? moveLayer(two, 1, -1) : null;
    expect(raised?.layers.map((layer) => layer.id)).toEqual(["decor", "ground"]);
    expect(deleteLayer(map, 0)).toBeNull();
    expect(deleteLayer(two ?? map, 1)?.layers).toHaveLength(1);
    let stacked = map;
    for (let index = 0; index < 5; index += 1) stacked = addLayer(stacked) ?? stacked;
    expect(stacked.layers).toHaveLength(4);
    expect(addLayer(stacked)).toBeNull();
  });

  it("changes the background only to a real colour", () => {
    expect(setBackground(level(), "#1B1E2B")?.background).toBe("#1b1e2b");
    expect(setBackground(level(), "blue")).toBeNull();
  });

  it("round-trips a grid through CSV", () => {
    const cells = [0, 1, 2, 0, 4, 0];
    const csv = writeGrid(cells, 3, 2);
    expect(csv).toBe("0,1,2\n0,4,0\n");
    expect(readGrid(csv ?? "", 3, 2, 8)).toEqual(cells);
    expect(readGrid("0, 1, 2\n0, 4, 0\n", 3, 2, 8)).toEqual(cells);
    expect(readGrid("0,1\n0,1\n", 3, 2, 8)).toBeNull();
    expect(readGrid("0,x,2\n0,1,0\n", 3, 2, 8)).toBeNull();
    expect(readGrid("0,9,2\n0,1,0\n", 3, 2, 8)).toBeNull();
  });

  it("draws a drag without gaps", () => {
    const points = linePoints(0, 0, 3, 1);
    const painted = paintLayer(level(), 0, points, 1);
    expect(points.every(([x, y]) => painted?.layers[0].cells[y * 10 + x] === 1)).toBe(true);
  });

  it("undoes a stroke and forgets the oldest step past the limit", () => {
    const sheet = starterTileset(16);
    const png = encodePng(sheet!);
    let history = historyStart({ map: level(), tileset: sheet!, tilesetPng: png });
    for (let index = 0; index < MAP_HISTORY_LIMIT + 5; index += 1) {
      const next = paintLayer(history.present.map, 0, [[index % 10, Math.floor(index / 10)]], 1);
      history = historyPush(history, { map: next ?? history.present.map, tileset: sheet!, tilesetPng: png });
    }
    expect(history.past.length).toBe(MAP_HISTORY_LIMIT);
    const undone = historyUndo(history);
    const last = 3 * 10 + 4;
    expect(history.present.map.layers[0].cells[last]).toBe(1);
    expect(undone?.present.map.layers[0].cells[last]).toBe(0);
    expect(historyRedo(undone!)?.present.map.layers[0].cells[last]).toBe(1);
    expect(mapFingerprint(history.present.map)).not.toContain("level-1");
  });

  it("suggests the next free slug and builds a starter sheet", () => {
    expect(nextMapSlug(["level-1"], "level-1")).toBe("level-1-2");
    expect(nextMapSlug([], "第一关")).toBeNull();
    const sheet = starterTileset(16);
    expect(sheet && [sheet.width, sheet.height]).toEqual([64, 32]);
    expect(starterCenter(sheet!, 16)).toEqual([56, 183, 100, 255]);
    expect(createMap({ slug: "no", name: "", columns: 10, rows: 8, tileWidth: 16, tileHeight: 16 })).toBeNull();
    expect(createMap({ slug: "no", name: "关", columns: 2, rows: 8, tileWidth: 16, tileHeight: 16 })).toBeNull();
  });
});
