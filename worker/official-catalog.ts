/**
 * Official catalog hits for MCP search.
 *
 * The bytes stay in public/asset-packs. This module only carries the fields a
 * search needs, so a tool can answer without writing a project.
 */
import forest from "../public/asset-packs/forest-adventure/manifest.json";
import sounds from "../public/asset-packs/forest-sounds/manifest.json";
import type { CatalogHit } from "../shared/catalog";

type PackJson = {
  id: string;
  assets: {
    id: string;
    title: string;
    path: string;
    mediaType: string;
    category: string;
    theme: string;
    tags: string[];
    license: { spdx: string };
    author: string;
    source: string;
    attribution: string;
  }[];
};

function hitsFrom(pack: PackJson): CatalogHit[] {
  return pack.assets.map((asset) => ({
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
  }));
}

export function officialCatalog(): CatalogHit[] {
  return [...hitsFrom(forest as PackJson), ...hitsFrom(sounds as PackJson)];
}
