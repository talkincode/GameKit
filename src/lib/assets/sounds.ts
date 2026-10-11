/**
 * Official forest sounds.
 *
 * Rendered by the same synthesizer the editor uses, then checked with the same
 * pack schema as the pictures. CC0, written by GameKit, not downloaded and not
 * produced by a generation API. Tags overlap the forest pictures so a jump
 * sound and the explorer sit in one set.
 */
import { renderEdited } from "../audio/edit";
import { SOUND_PRESETS, type SoundPreset } from "../audio/presets";
import { sha256Hex } from "./hash";
import { FOREST_AUTHOR, FOREST_LICENSE, FOREST_SOURCE } from "./forest";
import type { AssetPack, CatalogAsset } from "./schema";

export const SOUND_PACK_ID = "forest-sounds";

const ATTRIBUTION =
  "这些声音由 GameKit 用参数合成，以 CC0 1.0 贡献到公共领域。使用时无需署名。不是从第三方素材站搬运的，也不是调用生成接口做的。";

function filePath(preset: SoundPreset): string {
  return `sounds/${preset.spec.name}.wav`;
}

export async function buildSoundPack(): Promise<{ manifest: AssetPack; files: Record<string, Uint8Array> }> {
  const files: Record<string, Uint8Array> = {};
  const assets: CatalogAsset[] = [];
  for (const preset of SOUND_PRESETS) {
    const rendered = renderEdited(preset.spec, preset.edit);
    const path = filePath(preset);
    files[path] = rendered.wav;
    assets.push({
      id: preset.id,
      version: "1.0.0",
      title: preset.title,
      path,
      mediaType: "audio/wav",
      tags: preset.tags,
      theme: preset.theme,
      category: preset.kind,
      preview: path,
      license: FOREST_LICENSE,
      author: FOREST_AUTHOR,
      source: FOREST_SOURCE,
      attribution: ATTRIBUTION,
      sha256: await sha256Hex(rendered.wav),
    });
  }
  const manifest: AssetPack = {
    format: "gamekit.asset-pack",
    formatVersion: 1,
    id: SOUND_PACK_ID,
    version: "1.0.0",
    title: "森林声音",
    theme: "森林冒险",
    summary: "跳跃、轻跳、金币、碰到蘑菇，和一段可以循环的走路音乐。和森林的角色、金币、蘑菇用同一套标签连在一起。改参数就能做出另一种，不用重新画图。",
    license: FOREST_LICENSE,
    author: FOREST_AUTHOR,
    source: FOREST_SOURCE,
    attribution: ATTRIBUTION,
    assets,
  };
  return { manifest, files };
}
