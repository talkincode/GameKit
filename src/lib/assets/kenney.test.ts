import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectAudio } from "../audio/format";
import { framesFromDocument, parseSpriteAnim } from "../pixel/anim";
import { decodePng } from "../pixel/png";
import { assetDisplayName } from "./display";
import { checkAssetPacks } from "./check-disk";
import type { AssetPack } from "./schema";
import { librarySpriteNote } from "./sprite-note";
import { editorTileset } from "./tileset";

const root = join(process.cwd(), "public", "asset-packs");
const THEMES = [
  "kenney-dungeon",
  "kenney-platform",
  "kenney-puzzle",
  "kenney-racing",
  "kenney-sfx",
  "kenney-space",
  "kenney-ui",
];

function loadPack(id: string): AssetPack {
  return JSON.parse(readFileSync(join(root, id, "manifest.json"), "utf8")) as AssetPack;
}

describe("Kenney CC0 packs", () => {
  const ids = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("kenney-"))
    .map((entry) => entry.name)
    .sort();

  it("ships one pack for each theme and passes the ship gate", async () => {
    expect(ids).toEqual(THEMES);
    expect(await checkAssetPacks(root)).toEqual([]);
  });

  it("keeps the CC0 credit, a Chinese tag, and a playable ogg on every file", () => {
    for (const id of ids) {
      const pack = loadPack(id);
      expect(pack.author).toBe("Kenney");
      expect(pack.license.spdx).toBe("CC0-1.0");
      expect(pack.source).toMatch(/^https:\/\/kenney\.nl\//);
      expect(pack.attribution).toContain("Kenney");
      for (const asset of pack.assets) {
        expect(asset.author).toBe("Kenney");
        expect(asset.license.spdx).toBe("CC0-1.0");
        expect(asset.license.name.length).toBeGreaterThan(0);
        expect(asset.source).toMatch(/^https:\/\/kenney\.nl\//);
        expect(asset.attribution.length).toBeGreaterThan(0);
        expect(asset.tags.some((tag) => /[\u4e00-\u9fff]/.test(tag))).toBe(true);
        expect(assetDisplayName(asset).length).toBeGreaterThan(0);
        expect(/[\u4e00-\u9fff]/.test(assetDisplayName(asset))).toBe(true);
        const bytes = new Uint8Array(readFileSync(join(root, id, asset.path)));
        if (asset.mediaType === "audio/ogg") expect(inspectAudio(asset.path, bytes)?.ok).toBe(true);
      }
    }
  });

  it("fits dungeon, space, and puzzle sheets into the map editor", () => {
    const dungeon = loadPack("kenney-dungeon").assets.find((asset) => asset.id === "dungeon-tiles");
    const space = loadPack("kenney-space").assets.find((asset) => asset.id === "space-tiles");
    const puzzle = loadPack("kenney-puzzle").assets.find((asset) => asset.id === "puzzle-tiles");
    expect(dungeon && editorTileset(dungeon)).toMatchObject({ tileWidth: 16, names: expect.arrayContaining(["棕色地砖"]) });
    expect(space && editorTileset(space)?.tileWidth).toBe(16);
    expect(puzzle && editorTileset(puzzle)?.tileWidth).toBe(32);
    expect(loadPack("kenney-platform").assets.every((asset) => editorTileset(asset) === null)).toBe(true);
  });

  it("opens the walker sheet as two animation frames", () => {
    const walker = loadPack("kenney-platform").assets.find((asset) => asset.id === "platform-walker");
    expect(walker?.animation?.frames).toHaveLength(2);
    if (!walker?.animation) return;
    const decoded = decodePng(new Uint8Array(readFileSync(join(root, "kenney-platform", walker.path))));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const path = "assets/library/kenney-platform/characters/walker.png";
    const note = librarySpriteNote(path, walker.animation);
    expect(note).toBeTruthy();
    const parsed = parseSpriteAnim(note ?? "", path);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(framesFromDocument(decoded.pixels, parsed.document)).toHaveLength(2);
  });
});
