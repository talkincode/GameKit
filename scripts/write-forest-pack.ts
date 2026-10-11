import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildForestPack, catalogIndex } from "../src/lib/assets/forest";
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
await writeFile(join(root, "index.json"), `${JSON.stringify(catalogIndex([forest.manifest, sounds.manifest]), null, 2)}\n`);
