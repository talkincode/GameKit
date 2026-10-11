import { describe, expect, it } from "vitest";
import { clearCatalogCache, loadJson } from "./catalog";
import { filterAssets } from "./filter";
import { buildForestPack } from "./forest";

describe("catalog loading", () => {
  it("fetches each JSON url once per session", async () => {
    clearCatalogCache();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    await loadJson("/asset-packs/index.json", fetchImpl);
    await loadJson("/asset-packs/index.json", fetchImpl);
    expect(calls).toBe(1);
    clearCatalogCache();
  });

  it("filters by Chinese text, category, and tag", async () => {
    const { manifest } = await buildForestPack();
    expect(filterAssets(manifest.assets, { text: "金币", category: "all", theme: "all", tag: "all" }).map((asset) => asset.id)).toEqual(["coin"]);
    expect(filterAssets(manifest.assets, { text: "", category: "character", theme: "all", tag: "all" }).map((asset) => asset.id)).toEqual(["hero"]);
    expect(filterAssets(manifest.assets, { text: "森林", category: "all", theme: "森林冒险", tag: "树" }).map((asset) => asset.id)).toEqual(["tree"]);
    expect(filterAssets(manifest.assets, { text: "没有这种", category: "all", theme: "all", tag: "all" })).toEqual([]);
  });
});