import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { text } from "../../ui/text";
import { filterAssets, libraryFilterGroups } from "./filter";
import type { AssetPack, CatalogAsset } from "./schema";

function shippedAssets(): CatalogAsset[] {
  const root = join(process.cwd(), "public", "asset-packs");
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => (JSON.parse(readFileSync(join(root, entry.name, "manifest.json"), "utf8")) as AssetPack).assets);
}

const DUPLICATES = ["音效", "角色", "界面", "地形", "益智", "平台跳跃", "迷宫地牢", "音乐", "图块", "特效", "道具"];

describe("library filter groups", () => {
  const assets = shippedAssets();
  const groups = libraryFilterGroups(assets, text.library.categories);

  it("shows each of the old duplicate labels once", () => {
    const labels = [
      ...groups.categories.map((chip) => chip.label),
      ...groups.themes,
      ...groups.tags,
      ...groups.moreTags,
    ];
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of DUPLICATES) expect(labels.filter((item) => item === label)).toEqual([label]);
    expect(groups.categories.map((chip) => chip.label)).toContain("音效");
    expect(groups.themes).not.toContain("音效");
    expect([...groups.tags, ...groups.moreTags]).not.toContain("音效");
    expect(groups.themes).toContain("平台跳跃");
    expect([...groups.tags, ...groups.moreTags]).not.toContain("平台跳跃");
    expect([...groups.tags, ...groups.moreTags]).toContain("跳跃");
    expect(groups.moreTags.length).toBeGreaterThan(0);
    expect(groups.tags).toHaveLength(12);
  });

  it("keeps the type, theme, and tag results distinct", () => {
    const sounds = filterAssets(assets, { text: "", category: "sfx", theme: "all", tag: "all" });
    expect(sounds.every((asset) => asset.category === "sfx")).toBe(true);
    expect(sounds.map((asset) => asset.id)).toContain("sfx-boom");
    expect(sounds.map((asset) => asset.id)).toContain("jump-sfx");
    expect(sounds.map((asset) => asset.id)).not.toContain("hero");

    const platform = filterAssets(assets, { text: "", category: "all", theme: "平台跳跃", tag: "all" });
    expect(platform.map((asset) => asset.id)).toContain("platform-walker");
    expect(platform.map((asset) => asset.id)).not.toContain("sfx-boom");

    const jumps = filterAssets(assets, { text: "", category: "all", theme: "all", tag: "跳跃" });
    expect(jumps.map((asset) => asset.id)).toContain("jump-sfx");
    expect(jumps.map((asset) => asset.id)).not.toContain("hero");

    const both = filterAssets(assets, { text: "", category: "sfx", theme: "迷宫地牢", tag: "all" });
    expect(both.map((asset) => asset.id).sort()).toEqual(["dungeon-door-sfx", "dungeon-step"]);
  });
});
