import type { AssetCategory, CatalogAsset } from "./schema";

export type AssetQuery = {
  text: string;
  category: AssetCategory | "all";
  theme: string | "all";
  tag: string | "all";
};

/**
 * Other assets that share a tag. Style variants stay editable copies linked by
 * tags, so a sound and a picture can belong to one theme without a new drawing.
 */
export function relatedAssets(assets: CatalogAsset[], asset: CatalogAsset): CatalogAsset[] {
  const tags = new Set(asset.tags);
  return assets.filter((other) => other !== asset && other.id !== asset.id && other.tags.some((tag) => tags.has(tag)));
}

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
