import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildForestPack, catalogIndex } from "../src/lib/assets/forest";
import type { AssetPack } from "../src/lib/assets/schema";
import { buildSoundPack } from "../src/lib/assets/sounds";

/** Writes the committed packs under public/asset-packs. Run from the repo root after changing a drawing or a sound preset. */
const root = join(process.cwd(), "public", "asset-packs");

async function writePack(manifest: Awaited<ReturnType<typeof buildForestPack>>["manifest"], files: Record<string, Uint8Array>) {
  const packDir = join(root, manifest.id);
  for (const [path, bytes] of Object.entries(files)) {
    const file = join(packDir, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  await writeFile(join(packDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${manifest.assets.length} assets to ${packDir}`);
}

const forest = await buildForestPack();
const sounds = await buildSoundPack();
await writePack(forest.manifest, forest.files);
await writePack(sounds.manifest, sounds.files);

const folders = await readdir(root, { withFileTypes: true });
const packs: AssetPack[] = [];
for (const entry of folders) {
  if (!entry.isDirectory()) continue;
  packs.push(JSON.parse(await readFile(join(root, entry.name, "manifest.json"), "utf8")) as AssetPack);
}
const first = ["forest-adventure", "forest-sounds"];
packs.sort((a, b) => {
  const ai = first.indexOf(a.id);
  const bi = first.indexOf(b.id);
  if (ai !== -1 || bi !== -1) return (ai === -1 ? first.length : ai) - (bi === -1 ? first.length : bi);
  return a.id.localeCompare(b.id);
});
await writeFile(join(root, "index.json"), `${JSON.stringify(catalogIndex(packs), null, 2)}\n`);
