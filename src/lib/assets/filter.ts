import type { AssetCategory, CatalogAsset } from "./schema";

export type AssetQuery = {
  text: string;
  category: AssetCategory | "all";
  theme: string | "all";
  tag: string | "all";
};

/** Client-side filter. The pack JSON is already loaded; this does not fetch. */
export function filterAssets(assets: CatalogAsset[], query: AssetQuery): CatalogAsset[] {
  const needle = query.text.trim().toLowerCase();
  return assets.filter((asset) => {
    if (query.category !== "all" && asset.category !== query.category) return false;
    if (query.theme !== "all" && asset.theme !== query.theme) return false;
    if (query.tag !== "all" && !asset.tags.includes(query.tag)) return false;
    if (!needle) return true;
    const haystack = [asset.title, asset.id, asset.theme, asset.category, ...asset.tags].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}
