import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { renderEdited } from "./audio/edit";
import { soundPreset } from "./audio/presets";
import { applyLibraryCopy, libraryCopyFrom, readPins } from "./assets/copy";
import { buildForestPack } from "./assets/forest";
import { sha256Hex } from "./assets/hash";
import { buildSoundPack } from "./assets/sounds";
import { buildWebBundle } from "./build";
import { embedZip, sourceZip, webZip } from "./export";
import { writeMapFiles } from "./map/document";
import { createMap } from "./map/model";
import { planMapSave } from "./map/save";
import { auditExportedProject, auditWebArchive } from "./offline";
import { buildSpriteDocument } from "./pixel/anim";
import { createPixels } from "./pixel/buffer";
import { encodePng } from "./pixel/png";
import { planPixelSave } from "./pixel/save";
import { planSoundSave } from "./audio/save";
import { createRecipeProject } from "./recipes/catalog";
import type { Project } from "./project";

const template = readFileSync(new URL("../../runtime/player.tmpl", import.meta.url), "utf8");

async function studioProject(): Promise<Project> {
  const recipe = createRecipeProject("platform");
  if (!recipe) throw new Error("missing platform recipe");
  const forest = await buildForestPack();
  const sounds = await buildSoundPack();
  const coin = forest.manifest.assets.find((asset) => asset.id === "coin");
  const jump = sounds.manifest.assets.find((asset) => asset.id === "jump-sfx");
  if (!coin || !jump) throw new Error("missing library assets");

  const withCoin = await applyLibraryCopy(recipe, libraryCopyFrom(forest.manifest, coin, forest.files[coin.path]), "add", "file");
  const withJump = await applyLibraryCopy(
    withCoin.project,
    libraryCopyFrom(sounds.manifest, jump, sounds.files[jump.path]),
    "add",
    "file",
  );
  if (!withJump.ok) throw new Error("library copy failed");

  const sprite = buildSpriteDocument(
    "assets/walker.png",
    [
      { pixels: createPixels(16, 16, [239, 125, 87, 255]), durationMs: 125, name: "idle" },
      { pixels: createPixels(16, 16, [56, 183, 100, 255]), durationMs: 125, name: "walk" },
    ],
    { idle: [0], walk: [1] },
  );
  if (!sprite) throw new Error("sprite");
  const picture = planPixelSave(withJump.project, withJump.project.id, {
    path: "assets/walker.png",
    bytes: encodePng(sprite.sheet),
    mode: "create",
    sidecar: { path: "assets/walker.anim.json", text: sprite.json },
  });
  if (!picture.ok) throw new Error(picture.reason);

  const map = createMap({ slug: "level-1", name: "第一关", columns: 8, rows: 6, tileWidth: 16, tileHeight: 16 });
  const written = map ? writeMapFiles(map, encodePng(createPixels(64, 32, [56, 183, 100, 255]))) : null;
  if (!written) throw new Error("map files");
  const mapped = planMapSave(picture.next, picture.next.id, {
    mode: "create",
    previousPaths: [],
    documentPath: written.documentPath,
    documentText: written.documentText,
    texts: written.texts,
    tilesetPath: written.tilesetPath,
    tilesetPng: written.tilesetPng,
  });
  if (!mapped.ok) throw new Error(mapped.reason);

  const wav = renderEdited(soundPreset("jump-sfx").spec).wav;
  const sound = planSoundSave(mapped.next, { bytes: wav, suggested: "assets/jump.wav" });
  if (!sound.ok) throw new Error(sound.reason);
  return sound.next;
}

describe("offline export", () => {
  it("a recipe with a library copy, animation, map, and sound exports without the catalog", async () => {
    const project = await studioProject();
    const packed = unzipSync(sourceZip(project));
    const restored = {
      ...project,
      files: project.files.map((file) => {
        const bytes = packed[file.path];
        if (!bytes) throw new Error(`missing ${file.path}`);
        return file.text !== undefined ? { path: file.path, text: strFromU8(bytes) } : { path: file.path, bytes };
      }),
    };
    expect(await auditExportedProject(restored)).toEqual([]);

    const bundle = buildWebBundle(project, { template, preview: false });
    expect(await auditWebArchive(webZip(bundle), project)).toEqual([]);
    const embed = strFromU8(unzipSync(embedZip(bundle))["README.txt"]);
    expect(embed).toContain("https://pygame-web.github.io/cdn/0.9.3/");
    expect(embed).toContain("do not call GameKit");
    expect(embed).toContain("Without it, the web package does not start");

    const coin = packed["assets/library/forest-adventure/props/coin.png"];
    const jump = packed["assets/library/forest-sounds/sounds/jump.wav"];
    const forest = await buildForestPack();
    const sounds = await buildSoundPack();
    expect(Buffer.from(coin).equals(Buffer.from(forest.files["props/coin.png"]))).toBe(true);
    expect(Buffer.from(jump).equals(Buffer.from(sounds.files["sounds/jump.wav"]))).toBe(true);
    const pins = readPins(restored);
    expect(pins?.copies.map((pin) => pin.sha256).sort()).toEqual(
      [await sha256Hex(coin), await sha256Hex(jump)].sort(),
    );
    expect(strFromU8(packed["main.py"])).toContain('pygame.image.load("assets/hero.png")');
    expect(strFromU8(packed["main.py"])).not.toContain("/asset-packs/");
    expect(packed["assets/walker.anim.json"]).toBeTruthy();
    expect(packed["maps/level-1.map.json"]).toBeTruthy();
    expect(packed["maps/level-1.tileset.png"]).toBeTruthy();
    expect(packed["assets/jump.wav"]).toBeTruthy();
    expect(packed["recipe.json"]).toBeTruthy();
  });

  it("a newer catalog does not change an exported zip or a pinned copy", async () => {
    const forest = await buildForestPack();
    const coin = forest.manifest.assets.find((asset) => asset.id === "coin");
    if (!coin) throw new Error("missing coin");
    const copy = libraryCopyFrom(forest.manifest, coin, forest.files[coin.path]);
    const recipe = createRecipeProject("catch");
    if (!recipe) throw new Error("missing recipe");
    const added = await applyLibraryCopy(recipe, copy, "add", "none");
    const first = sourceZip(added.project);
    const firstWeb = webZip(buildWebBundle(added.project, { template, preview: false }));

    const newerBytes = new Uint8Array(copy.bytes);
    newerBytes[20] ^= 0xff;
    const newer = { ...copy, packVersion: "2.0.0", assetVersion: "2.0.0", bytes: newerBytes, sha256: await sha256Hex(newerBytes) };
    const kept = await applyLibraryCopy(added.project, newer, "keep", "none");
    expect(kept.changed).toBe(false);
    expect(unzipSync(sourceZip(kept.project))).toEqual(unzipSync(first));
    expect(readPins(kept.project)?.copies[0]).toMatchObject({ assetVersion: "1.0.0", sha256: copy.sha256 });

    const replaced = await applyLibraryCopy(added.project, newer, "replace", "none");
    expect(readPins(replaced.project)?.copies[0].assetVersion).toBe("2.0.0");
    expect(unzipSync(first)[added.path]).toEqual(copy.bytes);
    expect(unzipSync(sourceZip(replaced.project))[added.path]).toEqual(newerBytes);
    expect(unzipSync(unzipSync(firstWeb)["gamekit.apk"])[`assets/${added.path}`]).toEqual(copy.bytes);
    expect(fileStill(added.project, added.path)).toEqual(copy.bytes);
  });
});

function fileStill(project: Project, path: string): Uint8Array | undefined {
  return project.files.find((file) => file.path === path)?.bytes;
}
