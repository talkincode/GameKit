import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAssetPacks, packGateFailure } from "./check-disk";
import { buildForestPack, catalogIndex } from "./forest";
import type { AssetPack } from "./schema";
import { buildSoundPack } from "./sounds";
import { validateAssetPack } from "./validate";

const root = join(process.cwd(), "public", "asset-packs");

describe("forest adventure pack", () => {
  it("matches the generator and passes the ship gate", async () => {
    const built = await buildForestPack();
    const sounds = await buildSoundPack();
    const manifest = JSON.parse(readFileSync(join(root, "forest-adventure", "manifest.json"), "utf8"));
    const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8")) as { packs: { id: string }[] };
    expect(manifest).toEqual(built.manifest);
    const forestIndex = catalogIndex([built.manifest, sounds.manifest]);
    for (const pack of forestIndex.packs) {
      expect(index.packs.find((item) => item.id === pack.id)).toEqual(pack);
    }
    expect(index.packs.length).toBeGreaterThan(forestIndex.packs.length);
    for (const asset of built.manifest.assets) {
      const bytes = readFileSync(join(root, "forest-adventure", asset.path));
      expect(Buffer.from(bytes).equals(Buffer.from(built.files[asset.path]))).toBe(true);
    }
    expect(await checkAssetPacks(root)).toEqual([]);
    const soundManifest = JSON.parse(readFileSync(join(root, "forest-sounds", "manifest.json"), "utf8"));
    expect(soundManifest).toEqual(sounds.manifest);
    for (const asset of sounds.manifest.assets) {
      const bytes = readFileSync(join(root, "forest-sounds", asset.path));
      expect(Buffer.from(bytes).equals(Buffer.from(sounds.files[asset.path]))).toBe(true);
      expect(asset.license.spdx).toBe("CC0-1.0");
      expect(asset.author).toBe("GameKit");
      expect(asset.source).toMatch(/^https:\/\//);
      expect(asset.attribution.length).toBeGreaterThan(0);
      expect(asset.tags.some((tag: string) => /[\u4e00-\u9fff]/.test(tag))).toBe(true);
    }
    const soundChecked = await validateAssetPack(sounds.manifest, sounds.files);
    expect(soundChecked.ok).toBe(true);
    const checked = await validateAssetPack(built.manifest, built.files);
    expect(checked.ok).toBe(true);
  });

  it("blocks an empty license, author, source, or attribution", async () => {
    const built = await buildForestPack();
    const manifest = structuredClone(built.manifest);
    manifest.assets[0].author = "   ";
    manifest.assets[1].license = { spdx: "", name: "CC0", url: "https://creativecommons.org/publicdomain/zero/1.0/legalcode" };
    manifest.assets[2].source = "";
    manifest.attribution = "";
    const checked = await validateAssetPack(manifest, built.files);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.issues.every((issue) => issue.code === "provenance" || issue.code === "schema")).toBe(true);
    expect(checked.ok).toBe(false);
  });

  it("blocks a hash that does not match the file", async () => {
    const built = await buildForestPack();
    const manifest = structuredClone(built.manifest);
    manifest.assets[0].sha256 = "ab".repeat(32);
    const checked = await validateAssetPack(manifest, built.files);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.issues.map((issue) => issue.code)).toContain("hash-mismatch");
  });

  it("blocks a missing file, a non-Chinese tag, and a frame that does not fit", async () => {
    const built = await buildForestPack();
    const files = { ...built.files };
    delete files[built.manifest.assets[0].path];
    const missing = await validateAssetPack(built.manifest, files);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.issues.map((issue) => issue.code)).toContain("missing-file");

    const manifest = structuredClone(built.manifest);
    manifest.assets[0].tags = ["hero"];
    manifest.assets[0].animation = {
      frameWidth: 32,
      frameHeight: 32,
      frames: [{ index: 9, durationMs: 100 }],
    };
    const tagged = await validateAssetPack(manifest, built.files);
    expect(tagged.ok).toBe(false);
    if (!tagged.ok) {
      expect(tagged.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["tag-language", "animation"]));
    }
  });

  it("blocks an asset with no display name", async () => {
    const built = await buildForestPack();
    const manifest = structuredClone(built.manifest);
    manifest.assets[0].title = "   ";
    const checked = await validateAssetPack(manifest, built.files);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.issues.map((issue) => issue.code)).toContain("missing-title");
  });

  it("blocks an ogg that has no wav preview", async () => {
    const id = "kenney-sfx";
    const manifest = JSON.parse(readFileSync(join(root, id, "manifest.json"), "utf8")) as AssetPack;
    const files: Record<string, Uint8Array> = {};
    for (const asset of manifest.assets) {
      files[asset.path] = new Uint8Array(readFileSync(join(root, id, asset.path)));
      const preview = asset.path.replace(/\.ogg$/, ".preview.wav");
      files[preview] = new Uint8Array(readFileSync(join(root, id, preview)));
    }
    expect((await validateAssetPack(manifest, files)).ok).toBe(true);
    delete files[manifest.assets[0].path.replace(/\.ogg$/, ".preview.wav")];
    const missing = await validateAssetPack(manifest, files);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.issues.map((issue) => issue.code)).toContain("audio-preview");
  });

  it("blocks an audio file the browser runtime cannot play", async () => {
    const sounds = await buildSoundPack();
    const manifest = structuredClone(sounds.manifest);
    const files = { ...sounds.files, [manifest.assets[0].path]: new Uint8Array([1, 2, 3, 4]) };
    const { sha256Hex } = await import("./hash");
    manifest.assets[0].sha256 = await sha256Hex(files[manifest.assets[0].path]);
    const checked = await validateAssetPack(manifest, files);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.issues.map((issue) => issue.code)).toContain("audio-format");
  });
});

describe("asset pack build gate", () => {
  async function isolated(mutate: (manifest: AssetPack) => void): Promise<ReturnType<typeof checkAssetPacks>> {
    const root = mkdtempSync(join(tmpdir(), "gamekit-packs-"));
    try {
      cpSync(join(process.cwd(), "public", "asset-packs", "forest-adventure"), join(root, "forest-adventure"), { recursive: true });
      const manifest = JSON.parse(readFileSync(join(root, "forest-adventure", "manifest.json"), "utf8")) as AssetPack;
      writeFileSync(join(root, "index.json"), `${JSON.stringify(catalogIndex([manifest]), null, 2)}\n`);
      mutate(manifest);
      writeFileSync(join(root, "forest-adventure", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      return await checkAssetPacks(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it("a broken license or a bad hash stops the pack gate", async () => {
    expect(packGateFailure([])).toBeNull();

    const provenance = await isolated((manifest) => {
      manifest.assets[0].author = "   ";
      manifest.assets[1].license = { spdx: "", name: "CC0", url: "https://creativecommons.org/publicdomain/zero/1.0/legalcode" };
      manifest.assets[2].source = "";
      manifest.attribution = "";
    });
    expect(provenance.length).toBeGreaterThan(0);
    expect(provenance.every((issue) => issue.code === "provenance" || issue.code === "schema")).toBe(true);
    expect(packGateFailure(provenance)).toContain("provenance");

    const hashed = await isolated((manifest) => {
      manifest.assets[0].sha256 = "ab".repeat(32);
    });
    expect(hashed.map((issue) => issue.code)).toContain("hash-mismatch");
    expect(packGateFailure(hashed)).toContain("hash-mismatch");
  });
});
