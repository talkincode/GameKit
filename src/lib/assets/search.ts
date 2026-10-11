import type { CatalogHit } from "../../../shared/catalog";
import type { AssetPack } from "./schema";

/** The fields search and the model prompt need. Bytes stay in the pack files. */
export function hitsFromPacks(packs: AssetPack[]): CatalogHit[] {
  return packs.flatMap((pack) =>
    pack.assets.map((asset) => ({
      packId: pack.id,
      assetId: asset.id,
      title: asset.title,
      path: asset.path,
      mediaType: asset.mediaType,
      category: asset.category,
      theme: asset.theme,
      tags: asset.tags,
      license: asset.license.spdx,
      author: asset.author,
      source: asset.source,
      attribution: asset.attribution,
    })),
  );
}
