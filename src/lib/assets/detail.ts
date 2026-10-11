import type { AssetCategory, CatalogAsset } from "./schema";

/**
 * What the library detail panel shows, and in which order.
 *
 * The bar repeats at most two type-specific actions. `more` is the full list
 * of secondary actions, so 「更多」 stays a complete menu. Copying into the
 * project is the primary button and is not in this list.
 */

export type SecondaryAction = "hear" | "openSprite" | "try" | "saveExample" | "copyCode" | "propose";

export type IntroSpec = { kind: "states"; states: string } | { kind: "moving" } | { kind: AssetCategory };

const TECHNICAL = /像素|帧|格子|精灵|转码|透明|动画编辑器|地图编辑器|OGG|Vorbis|宽窄|最近邻|原始包/;

export function assetIntroSpec(asset: Pick<CatalogAsset, "category" | "animation">): IntroSpec {
  if (asset.category === "character" && asset.animation) {
    const names = asset.animation.states ? Object.keys(asset.animation.states) : [];
    if (names.length > 0) return { kind: "states", states: names.join("、") };
    return { kind: "moving" };
  }
  return { kind: asset.category };
}

/**
 * Credit stays in the adult section. Notes about resized frames, grids, and
 * codecs drop to the bottom so a child never has to read them.
 */
export function attributionView(attribution: string): { credit: string; technical: string } {
  const parts = attribution.split("。");
  const sentences = parts
    .map((part, index) => {
      const sentence = part.trim();
      if (!sentence) return "";
      const last = index === parts.length - 1;
      return last && !attribution.trimEnd().endsWith("。") ? sentence : `${sentence}。`;
    })
    .filter(Boolean);
  const firstTechnical = sentences.findIndex((sentence) => TECHNICAL.test(sentence));
  if (firstTechnical <= 0) return { credit: sentences.join(""), technical: "" };
  return {
    credit: sentences.slice(0, firstTechnical).join(""),
    technical: sentences.slice(firstTechnical).join(""),
  };
}

export function detailActions(asset: Pick<CatalogAsset, "animation" | "mediaType">): {
  shortcuts: SecondaryAction[];
  more: SecondaryAction[];
} {
  const shortcuts: SecondaryAction[] = [];
  if (asset.animation) shortcuts.push("openSprite");
  if (asset.mediaType.startsWith("audio/") && shortcuts.length < 2) shortcuts.push("hear");

  const more: SecondaryAction[] = [];
  if (asset.animation) more.push("openSprite");
  if (asset.mediaType.startsWith("audio/")) more.push("hear");
  more.push("try", "saveExample", "copyCode", "propose");
  return { shortcuts, more };
}

/** Column and row of one animation frame on a left-to-right, top-to-bottom sheet. */
export function frameOrigin(sheetWidth: number, frameWidth: number, index: number): { col: number; row: number } {
  const columns = Math.max(1, Math.floor(sheetWidth / Math.max(1, frameWidth)));
  const safe = Math.max(0, index);
  return { col: safe % columns, row: Math.floor(safe / columns) };
}

/** Integer scale that keeps one frame near `maxPx` without blowing past 8×. */
export function previewScale(frame: number, maxPx = 160): number {
  if (!Number.isFinite(frame) || frame <= 0) return 1;
  return Math.max(1, Math.min(8, Math.floor(maxPx / frame)));
}
