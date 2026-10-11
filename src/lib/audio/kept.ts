/**
 * Sounds the child kept on this computer.
 *
 * Official packs live in public/asset-packs. A sound made in the editor (a
 * preset or a spec the model picked) uses the same catalog fields and the same
 * format check, then sits in IndexedDB until the child copies it into a project.
 */
import { loadKeptSounds, removeKeptSound, saveKeptSound } from "../storage";
import { sha256Hex } from "../assets/hash";
import { FOREST_LICENSE, FOREST_SOURCE } from "../assets/forest";
import { assetPackSchema, catalogAssetSchema, type AssetPack, type CatalogAsset } from "../assets/schema";
import { inspectAudio } from "./format";

type SoundKind = "sfx" | "music";

export const KEPT_PACK_ID = "my-sounds";

const ATTRIBUTION = "这是你在 GameKit 里调出来的声音，存在这台电脑上。听到的和保存的是同一份，不经过网上的生成接口。";

function hasCjk(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

export async function buildKeptAsset(input: {
  bytes: Uint8Array;
  title: string;
  kind: SoundKind;
  tags: string[];
}): Promise<CatalogAsset | null> {
  const verdict = inspectAudio("assets/kept.wav", input.bytes);
  if (!verdict?.ok) return null;
  const hash = await sha256Hex(input.bytes);
  const id = `s${hash.slice(0, 10)}`;
  const tags = [...new Set([...input.tags, input.kind === "music" ? "音乐" : "音效", "我做的"].filter(hasCjk))];
  if (!tags.length) return null;
  const title = hasCjk(input.title) ? input.title.trim().slice(0, 24) : input.kind === "music" ? "我的音乐" : "我的音效";
  const path = `sounds/${id}.wav`;
  const parsed = catalogAssetSchema.safeParse({
    id,
    version: "1.0.0",
    title,
    path,
    mediaType: "audio/wav",
    tags,
    theme: "我的声音",
    category: input.kind,
    preview: path,
    license: FOREST_LICENSE,
    author: "你",
    source: FOREST_SOURCE,
    attribution: ATTRIBUTION,
    sha256: hash,
  });
  return parsed.success ? parsed.data : null;
}

export async function keepSound(input: {
  bytes: Uint8Array;
  title: string;
  kind: SoundKind;
  tags: string[];
}): Promise<{ ok: true; asset: CatalogAsset } | { ok: false; reason: "bad-audio" | "write-failed" }> {
  const asset = await buildKeptAsset(input);
  if (!asset) return { ok: false, reason: "bad-audio" };
  try {
    await saveKeptSound({ id: asset.id, createdAt: Date.now(), bytes: new Uint8Array(input.bytes), asset });
    return { ok: true, asset };
  } catch (error) {
    console.warn("Keeping the sound failed:", error);
    return { ok: false, reason: "write-failed" };
  }
}

export async function forgetKeptSound(id: string): Promise<void> {
  await removeKeptSound(id);
}

/** A pack the library dialog can merge with the official ones. Empty when nothing was kept. */
export async function loadKeptPack(): Promise<{ pack: AssetPack; files: Record<string, Uint8Array> } | null> {
  const rows = await loadKeptSounds();
  const files: Record<string, Uint8Array> = {};
  const assets: CatalogAsset[] = [];
  for (const row of rows) {
    const parsed = catalogAssetSchema.safeParse(row.asset);
    if (!parsed.success) continue;
    const bytes = row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array();
    if ((await sha256Hex(bytes)) !== parsed.data.sha256) continue;
    const verdict = inspectAudio(parsed.data.path, bytes);
    if (!verdict?.ok) continue;
    files[parsed.data.path] = bytes;
    assets.push(parsed.data);
  }
  if (!assets.length) return null;
  const pack = assetPackSchema.parse({
    format: "gamekit.asset-pack",
    formatVersion: 1,
    id: KEPT_PACK_ID,
    version: "1.0.0",
    title: "我做的声音",
    theme: "我的声音",
    summary: "你在声音编辑器里收录的声音，存在这台电脑上。复制进项目之后，游戏不再来这里取。",
    license: FOREST_LICENSE,
    author: "你",
    source: FOREST_SOURCE,
    attribution: ATTRIBUTION,
    assets,
  });
  return { pack, files };
}
