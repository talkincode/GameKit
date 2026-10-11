import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildForestPack, catalogIndexFor } from "../src/lib/assets/forest";

/** Writes the committed starter pack under public/asset-packs. Run from the repo root after changing the drawings. */
const root = join(process.cwd(), "public", "asset-packs");
const built = await buildForestPack();
const packDir = join(root, built.manifest.id);
for (const [path, bytes] of Object.entries(built.files)) {
  const file = join(packDir, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
}
await writeFile(join(packDir, "manifest.json"), `${JSON.stringify(built.manifest, null, 2)}\n`);
await writeFile(join(root, "index.json"), `${JSON.stringify(catalogIndexFor(built.manifest), null, 2)}\n`);
console.log(`Wrote ${built.manifest.assets.length} assets to ${packDir}`);
