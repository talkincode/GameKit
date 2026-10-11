/**
 * Read-only view of one catalog asset.
 *
 * The page searches packs it has loaded. The Worker searches the same shape
 * built from the official manifests. Neither path writes a project.
 */

export type CatalogHit = {
  packId: string;
  assetId: string;
  title: string;
  /** Path inside the pack, not the project path. */
  path: string;
  mediaType: string;
  category: string;
  theme: string;
  tags: string[];
  license: string;
  author: string;
  source: string;
  attribution: string;
};

/** Where a copy lands. The game loads this path; it does not fetch the pack. */
export function libraryAssetPath(hit: Pick<CatalogHit, "packId" | "path">): string {
  return `assets/library/${hit.packId}/${hit.path}`;
}

export function findHit(hits: CatalogHit[], packId: string, assetId: string): CatalogHit | null {
  return hits.find((hit) => hit.packId === packId && hit.assetId === assetId) ?? null;
}

/**
 * Case-insensitive search over title, id, theme, category and tags.
 * An empty query returns the first matches, capped so a prompt stays small.
 */
export function searchCatalog(hits: CatalogHit[], query: string, limit = 24): CatalogHit[] {
  const needle = query.trim().toLowerCase();
  const matched = needle
    ? hits.filter((hit) =>
        [hit.title, hit.assetId, hit.packId, hit.theme, hit.category, ...hit.tags].join(" ").toLowerCase().includes(needle),
      )
    : hits;
  return matched.slice(0, limit);
}

/** One line per hit, for a model prompt. Bytes are not included. */
export function catalogLines(hits: CatalogHit[]): string {
  return hits
    .map((hit) => `${hit.packId} ${hit.assetId} ${hit.title} ${hit.category} ${hit.tags.join("/")}`)
    .join("\n");
}
