import { assetPackSchema, catalogIndexSchema, type AssetPack } from "./schema";

/** Static files under public/asset-packs. Not imported into the JS bundle. */
export const ASSET_PACK_PREFIX = "/asset-packs";

const jsonCache = new Map<string, Promise<unknown>>();

export function clearCatalogCache(): void {
  jsonCache.clear();
}

/**
 * Session cache for pack JSON. Thumbnails are ordinary <img> requests, so the
 * first screen never downloads the pictures, and a second look doesn't refetch.
 */
export function loadJson(url: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const cached = jsonCache.get(url);
  if (cached) return cached;
  const pending = fetchImpl(url).then(async (response) => {
    if (!response.ok) throw new Error(`Could not load ${url}`);
    return response.json() as Promise<unknown>;
  });
  jsonCache.set(url, pending);
  pending.catch(() => {
    if (jsonCache.get(url) === pending) jsonCache.delete(url);
  });
  return pending;
}

export function packAssetUrl(packId: string, assetPath: string): string {
  return `${ASSET_PACK_PREFIX}/${packId}/${assetPath}`;
}

export async function loadLibrary(fetchImpl: typeof fetch = fetch): Promise<AssetPack[]> {
  const index = catalogIndexSchema.parse(await loadJson(`${ASSET_PACK_PREFIX}/index.json`, fetchImpl));
  const packs: AssetPack[] = [];
  for (const entry of index.packs) {
    const manifest = await loadJson(`${ASSET_PACK_PREFIX}/${entry.id}/manifest.json`, fetchImpl);
    packs.push(assetPackSchema.parse(manifest));
  }
  return packs;
}

export async function loadAssetBytes(packId: string, assetPath: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const response = await fetchImpl(packAssetUrl(packId, assetPath));
  if (!response.ok) throw new Error(`Could not load ${assetPath}`);
  return new Uint8Array(await response.arrayBuffer());
}
