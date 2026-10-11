import { ASSET_CATEGORIES, type AssetCategory, type CatalogAsset } from "./schema";

/** How many tag chips stay on the row before the rest fold under 更多. */
export const LIBRARY_VISIBLE_TAGS = 12;

export type LibraryCategoryChip = { id: AssetCategory; label: string };

export type LibraryFilterGroups = {
  categories: LibraryCategoryChip[];
  themes: string[];
  tags: string[];
  moreTags: string[];
};

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

/**
 * Chips for the library dialog, one label each.
 *
 * Category, theme, and tag used to share one row, so 音效 / 角色 / 界面 and
 * the other overlapping names were drawn two or three times. A label is kept
 * in the highest group that owns it (类型, then 主题, then 标签). The chip
 * still filters only that group: 类型 is `category`, 主题 is `theme`, 标签 is
 * `tag`. `filterAssets` is unchanged, so the remaining chip matches the same
 * assets the old button of that group matched.
 */
export function libraryFilterGroups(
  assets: CatalogAsset[],
  categoryLabels: Readonly<Record<AssetCategory, string>>,
  tagLimit = LIBRARY_VISIBLE_TAGS,
): LibraryFilterGroups {
  const used = new Set<string>();
  const categories: LibraryCategoryChip[] = [];
  for (const id of ASSET_CATEGORIES) {
    if (!assets.some((asset) => asset.category === id)) continue;
    const label = categoryLabels[id];
    categories.push({ id, label });
    used.add(label);
  }

  const themes: string[] = [];
  const seenThemes = new Set<string>();
  for (const asset of assets) {
    if (seenThemes.has(asset.theme)) continue;
    seenThemes.add(asset.theme);
    if (used.has(asset.theme)) continue;
    themes.push(asset.theme);
    used.add(asset.theme);
  }

  const counts = new Map<string, number>();
  for (const asset of assets) {
    for (const tag of asset.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const tags = [...counts.keys()]
    .filter((tag) => !used.has(tag))
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b, "zh-CN"));
  const limit = Math.max(0, tagLimit);
  return { categories, themes, tags: tags.slice(0, limit), moreTags: tags.slice(limit) };
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
