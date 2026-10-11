/**
 * The name on a library card.
 *
 * Manifest `title` is that name. Official packs store a Chinese title there;
 * the ship gate rejects an empty one (`missing-title`) and a title with no
 * Chinese (`title-language`). The card renders this string, not the file name.
 */
export function assetDisplayName(asset: { title: string }): string {
  return asset.title.trim();
}
