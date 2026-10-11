import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { catalogIndexSchema } from "./schema";
import { validateAssetPack, type PackIssue } from "./validate";

/**
 * Reads public/asset-packs and refuses to build when a pack is incomplete.
 * Vite calls this from buildStart. Unit tests call it on the same folder.
 */
export async function checkAssetPacks(root: string): Promise<PackIssue[]> {
  const issues: PackIssue[] = [];
  let indexRaw: unknown;
  try {
    indexRaw = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
  } catch (error) {
    return [{ code: "schema", message: `Could not read the catalog index: ${error instanceof Error ? error.message : "unknown"}` }];
  }
  const index = catalogIndexSchema.safeParse(indexRaw);
  if (!index.success) {
    return index.error.issues.map((issue) => ({
      code: "schema" as const,
      path: issue.path.join("."),
      message: `index: ${issue.message}`,
    }));
  }

  const folders = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const listed = index.data.packs.map((pack) => pack.id);
  for (const folder of folders) {
    if (!listed.includes(folder)) issues.push({ code: "schema", message: `Folder ${folder} is not listed in the catalog index.` });
  }
  for (const id of listed) {
    if (!folders.includes(id)) issues.push({ code: "missing-file", message: `Index lists ${id} but the folder is missing.` });
  }
  if (new Set(listed).size !== listed.length) issues.push({ code: "duplicate-id", message: "The catalog index lists the same pack twice." });

  for (const entry of index.data.packs) {
    const dir = join(root, entry.id);
    let manifest: unknown;
    try {
      manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    } catch (error) {
      issues.push({ code: "missing-file", path: entry.id, message: `Could not read ${entry.id}/manifest.json: ${error instanceof Error ? error.message : "unknown"}` });
      continue;
    }
    const record = manifest as { version?: string; assets?: { path: string }[] };
    if (record.version !== entry.version) {
      issues.push({ code: "schema", path: entry.id, message: `${entry.id} index version ${entry.version} does not match the manifest.` });
    }
    if (!Array.isArray(record.assets) || record.assets.length !== entry.assetCount) {
      issues.push({ code: "schema", path: entry.id, message: `${entry.id} asset count does not match the index.` });
    }
    const files: Record<string, Uint8Array> = {};
    if (Array.isArray(record.assets)) {
      for (const asset of record.assets) {
        if (!asset || typeof asset.path !== "string") continue;
        try {
          files[asset.path] = readFileSync(join(dir, asset.path));
        } catch {
          // validateAssetPack reports the missing file.
        }
      }
    }
    const checked = await validateAssetPack(manifest, files);
    if (!checked.ok) issues.push(...checked.issues);
  }
  return issues;
}
