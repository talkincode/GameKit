import { describe, expect, it } from "vitest";
import { encodePng } from "../pixel/png";
import { readPixel } from "../pixel/buffer";
import { exportBundle, importBundle, isMapDataPath, readMapFiles, retargetDraft, writeMapFiles } from "./document";
import { addLayer, createMap, deleteLayer, mapFingerprint, paintCollision, paintLayer, setSpawn, toggleObject } from "./model";
import { pygameMapDemo, pygameMapModule, pygameMapSnippet } from "./pygame";
import { starterTileset } from "./tileset";

function painted() {
  const sheet = starterTileset(16);
  if (!sheet) throw new Error("sheet");
  let map = createMap({ slug: "level-1", name: "第一关", columns: 10, rows: 8, tileWidth: 16, tileHeight: 16 });
  if (!map) throw new Error("map");
  map = paintLayer(map, 0, [[2, 3]], 1) ?? map;
  map = addLayer(map) ?? map;
  map = paintLayer(map, 1, [[0, 0]], 4) ?? map;
  map = paintCollision(map, [[2, 3], [3, 3]], 1) ?? map;
  map = setSpawn(map, 2, 7) ?? map;
  map = toggleObject(map, 4, 5, "coin") ?? map;
  return { map, png: encodePng(sheet), sheet };
}

describe("map files", () => {
  it("writes JSON, CSV, and PNG that read back the same map", () => {
    const { map, png, sheet } = painted();
    const files = writeMapFiles(map, png);
    expect(files?.documentPath).toBe("maps/level-1.map.json");
    expect(files?.texts.map((file) => file.path)).toEqual([
      "maps/level-1.collision.csv",
      "maps/level-1.ground.csv",
      "maps/level-1.decor.csv",
    ]);
    const read = readMapFiles(
      [
        { path: files!.documentPath, text: files!.documentText },
        ...files!.texts,
        { path: files!.tilesetPath, bytes: png },
      ],
      files!.documentPath,
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(mapFingerprint(read.draft.map)).toBe(mapFingerprint(map));
    expect(read.draft.map.slug).toBe("level-1");
    expect(read.draft.tilesetPng).toBe(png);
    expect(readPixel(read.draft.tileset, 8, 8)).toEqual(readPixel(sheet, 8, 8));
    const again = writeMapFiles(read.draft.map, read.draft.tilesetPng);
    expect(again?.documentText).toBe(files?.documentText);
  });

  it("round-trips a bundle and can store it under another slug", () => {
    const { map, png } = painted();
    const files = writeMapFiles(map, png);
    const bundle = exportBundle({ map, tileset: starterTileset(16)!, tilesetPng: png });
    expect(bundle).toContain("gamekit.map-bundle");
    const imported = importBundle(bundle ?? "");
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(mapFingerprint(imported.draft.map)).toBe(mapFingerprint(map));
    expect(imported.draft.tilesetPng).toEqual(png);
    const moved = retargetDraft(imported.draft, "level-2");
    const saved = moved ? writeMapFiles(moved.map, moved.tilesetPng) : null;
    expect(saved?.documentPath).toBe("maps/level-2.map.json");
    expect(saved?.documentText).toContain("maps/level-2.ground.csv");
    expect(saved?.texts.find((file) => file.path.endsWith(".ground.csv"))?.text).toBe(
      files?.texts.find((file) => file.path.endsWith(".ground.csv"))?.text,
    );
    expect(mapFingerprint(moved!.map)).toBe(mapFingerprint(map));
  });

  it("rejects a broken document and does not follow a path out of the map", () => {
    const { map, png } = painted();
    const files = writeMapFiles(map, png);
    expect(importBundle("{")).toEqual({ ok: false, reason: "not-json" });
    expect(importBundle(JSON.stringify({ format: "nope", formatVersion: 1, files: [] }))).toEqual({ ok: false, reason: "format" });
    const broken = readMapFiles([{ path: "maps/level-1.map.json", text: "{" }], "maps/level-1.map.json");
    expect(broken).toEqual({ ok: false, reason: "not-json" });
    const hijack = JSON.parse(files!.documentText) as { collision: string; tileset: { image: string } };
    hijack.collision = "main.py";
    const hijacked = readMapFiles(
      [
        { path: files!.documentPath, text: JSON.stringify(hijack) },
        ...files!.texts,
        { path: "main.py", text: "print('no')\n" },
        { path: files!.tilesetPath, bytes: png },
      ],
      files!.documentPath,
    );
    expect(hijacked).toEqual({ ok: false, reason: "collision" });
    hijack.collision = "maps/level-1.collision.csv";
    hijack.tileset.image = "assets/player.png";
    const wrongSheet = readMapFiles(
      [{ path: files!.documentPath, text: JSON.stringify(hijack) }, ...files!.texts, { path: files!.tilesetPath, bytes: png }],
      files!.documentPath,
    );
    expect(wrongSheet).toEqual({ ok: false, reason: "tileset" });
  });

  it("rejects a CSV that does not match the map", () => {
    const { map, png } = painted();
    const files = writeMapFiles(map, png);
    const texts = files!.texts.map((file) => (file.path.endsWith(".collision.csv") ? { ...file, text: "1,2,3\n" } : file));
    const read = readMapFiles(
      [{ path: files!.documentPath, text: files!.documentText }, ...texts, { path: files!.tilesetPath, bytes: png }],
      files!.documentPath,
    );
    expect(read).toEqual({ ok: false, reason: "collision" });
  });

  it("still reads after a layer file is what the JSON names", () => {
    const { map, png } = painted();
    const thinner = deleteLayer(map, 1);
    const files = writeMapFiles(thinner ?? map, png);
    expect(files?.texts.some((file) => file.path.endsWith(".decor.csv"))).toBe(false);
    expect(isMapDataPath("maps/level-1.map.json")).toBe(true);
    expect(isMapDataPath("maps/level-1.ground.csv")).toBe(true);
    expect(isMapDataPath("maps/level-1.tileset.png")).toBe(true);
    expect(isMapDataPath("main.py")).toBe(false);
  });

  it("shows pygame how to load collision and spawn without a private API", () => {
    const snippet = pygameMapSnippet("maps/level-1.map.json");
    const moduleText = pygameMapModule();
    const demo = pygameMapDemo("maps/level-1.map.json");
    for (const source of [snippet, moduleText, demo]) {
      expect(source).not.toContain("import gamekit");
      expect(source).not.toContain("gamekit.");
    }
    expect(snippet).toContain("tileWidth");
    expect(moduleText).toContain("def load_map");
    expect(moduleText).toContain("def solid_at");
    expect(moduleText).toContain('info["collision"]');
    expect(demo).toContain("MAP-OK");
    expect(demo).toContain("asyncio.sleep(0)");
    expect(demo).toContain("maps/level-1.map.json");
    expect(demo).toContain("convert_alpha");
  });
});
