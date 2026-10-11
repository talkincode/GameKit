import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAssetPacks } from "./check-disk";
import { buildForestPack, catalogIndexFor } from "./forest";
import { validateAssetPack } from "./validate";

const root = join(process.cwd(), "public", "asset-packs");

describe("forest adventure pack", () => {
  it("matches the generator and passes the ship gate", async () => {
    const built = await buildForestPack();
    const manifest = JSON.parse(readFileSync(join(root, "forest-adventure", "manifest.json"), "utf8"));
    const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
    expect(manifest).toEqual(built.manifest);
    expect(index).toEqual(catalogIndexFor(built.manifest));
    for (const asset of built.manifest.assets) {
      const bytes = readFileSync(join(root, "forest-adventure", asset.path));
      expect(Buffer.from(bytes).equals(Buffer.from(built.files[asset.path]))).toBe(true);
    }
    expect(await checkAssetPacks(root)).toEqual([]);
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
});
