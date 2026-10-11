/**
 * Turning a catalog id into files on a *copy* of the project.
 *
 * The caller's project is not modified. A conflict (the path already holds
 * different bytes) returns the same project and does not write a second file.
 * Adoption is a later step, in the studio.
 */
import { loadAssetBytes, loadLibrary } from "./catalog";
import { libraryCopyFrom, applyLibraryCopy, type LibraryAssetCopy } from "./copy";
import { KEPT_PACK_ID, loadKeptPack } from "../audio/kept";

export type AssetIntent = { packId: string; assetId: string };

export type MaterializeResult =
  | { ok: true; project: import("../project").Project; path: string }
  | { ok: false; reason: "identical" | "conflict" | "hash"; project: import("../project").Project };

export async function resolveCatalogCopy(packId: string, assetId: string): Promise<LibraryAssetCopy | null> {
  const packs = await loadLibrary();
  const kept = await loadKeptPack().catch(() => null);
  const all = kept ? [...packs, kept.pack] : packs;
  const pack = all.find((item) => item.id === packId);
  const asset = pack?.assets.find((item) => item.id === assetId);
  if (!pack || !asset) return null;
  const bytes =
    pack.id === KEPT_PACK_ID ? kept?.files[asset.path] : await loadAssetBytes(pack.id, asset.path);
  if (!bytes) return null;
  return libraryCopyFrom(pack, asset, bytes);
}

/**
 * Copies one asset onto a new project value, using the library's own rules:
 * add when the path is free, refuse when it would replace different bytes.
 */
export async function materializeAsset(
  project: import("../project").Project,
  copy: LibraryAssetCopy,
): Promise<MaterializeResult> {
  const result = await applyLibraryCopy(project, copy, "add", "file");
  if (result.code === "hash-mismatch") return { ok: false, reason: "hash", project };
  if (result.code === "needs-choice") return { ok: false, reason: "conflict", project };
  if (!result.changed) return { ok: false, reason: "identical", project };
  return { ok: true, project: result.project, path: result.path };
}
