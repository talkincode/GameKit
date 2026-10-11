import { createPixels, type Pixels, type Rgba } from "../pixel/buffer";
import { encodePng } from "../pixel/png";
import { sha256Hex } from "./hash";
import { catalogIndexSchema, type AssetPack, type CatalogAsset, type CatalogIndex, type LicenseInfo } from "./schema";

/**
 * Forest adventure starter pack.
 *
 * Drawn for GameKit and released CC0. It is not a copy of a third-party pack:
 * every pixel, the license, the author, and the source are ours to stand behind.
 * Later packs can add other CC0 sources (Kenney and similar) the same way,
 * once each file has been reviewed and the provenance fields are filled in.
 */

const OUTLINE: Rgba = [43, 33, 24, 255];
const SKIN: Rgba = [242, 199, 160, 255];
const HAIR: Rgba = [92, 58, 36, 255];
const TUNIC: Rgba = [61, 140, 74, 255];
const TUNIC_DARK: Rgba = [36, 102, 54, 255];
const PANTS: Rgba = [74, 52, 36, 255];
const LEAF: Rgba = [47, 140, 72, 255];
const LEAF_LIGHT: Rgba = [126, 196, 78, 255];
const TRUNK: Rgba = [107, 66, 38, 255];
const RED: Rgba = [208, 78, 68, 255];
const WHITE: Rgba = [244, 241, 234, 255];
const GOLD: Rgba = [240, 193, 74, 255];
const GOLD_DARK: Rgba = [176, 116, 32, 255];
const DIRT: Rgba = [122, 84, 52, 255];
const DIRT_DARK: Rgba = [74, 50, 34, 255];
const GRASS: Rgba = [78, 168, 74, 255];
const GRASS_DARK: Rgba = [36, 112, 52, 255];
const PACK: Rgba = [90, 62, 40, 255];

export const FOREST_LICENSE: LicenseInfo = {
  spdx: "CC0-1.0",
  name: "CC0 1.0 Universal",
  url: "https://creativecommons.org/publicdomain/zero/1.0/legalcode",
};

export const FOREST_AUTHOR = "GameKit";
export const FOREST_SOURCE = "https://github.com/talkincode/GameKit";
export const FOREST_ATTRIBUTION =
  "本包由 GameKit 原创绘制，以 CC0 1.0 贡献到公共领域。使用时无需署名。不是从第三方素材站搬运的。";

const credit = {
  license: FOREST_LICENSE,
  author: FOREST_AUTHOR,
  source: FOREST_SOURCE,
  attribution: FOREST_ATTRIBUTION,
  theme: "森林冒险",
};

function put(pixels: Pixels, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) return;
  const at = (y * pixels.width + x) * 4;
  pixels.data[at] = color[0];
  pixels.data[at + 1] = color[1];
  pixels.data[at + 2] = color[2];
  pixels.data[at + 3] = color[3];
}

function rect(pixels: Pixels, x: number, y: number, width: number, height: number, color: Rgba): void {
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) put(pixels, x + column, y + row, color);
  }
}

function disc(pixels: Pixels, cx: number, cy: number, radius: number, color: Rgba): void {
  const limit = radius * radius;
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= limit) put(pixels, x, y, color);
    }
  }
}

function drawExplorer(pixels: Pixels, ox: number, step: 0 | 1): void {
  const shift = step === 0 ? 0 : 3;
  rect(pixels, ox + 11 - shift, 24, 4, 3, OUTLINE);
  rect(pixels, ox + 17 + shift, 24, 4, 3, OUTLINE);
  rect(pixels, ox + 12 - shift, 20, 3, 5, PANTS);
  rect(pixels, ox + 17 + shift, 20, 3, 5, PANTS);
  rect(pixels, ox + 10, 14, 12, 7, TUNIC);
  rect(pixels, ox + 10, 18, 12, 2, TUNIC_DARK);
  rect(pixels, ox + (step ? 21 : 8), 15, 3, 5, SKIN);
  rect(pixels, ox + 8, 15, 3, 5, PACK);
  rect(pixels, ox + 11, 8, 10, 7, SKIN);
  rect(pixels, ox + 11, 6, 10, 3, HAIR);
  rect(pixels, ox + 19, 8, 3, 5, HAIR);
  put(pixels, ox + 13, 11, OUTLINE);
  put(pixels, ox + 16, 11, OUTLINE);
  put(pixels, ox + 14, 13, RED);
}

function heroSheet(): Pixels {
  const pixels = createPixels(64, 32);
  drawExplorer(pixels, 0, 0);
  drawExplorer(pixels, 32, 1);
  return pixels;
}

function grassTile(): Pixels {
  const pixels = createPixels(16, 16, DIRT);
  rect(pixels, 0, 0, 16, 5, GRASS);
  rect(pixels, 0, 5, 16, 1, GRASS_DARK);
  for (const x of [2, 6, 11, 14]) put(pixels, x, 1, LEAF_LIGHT);
  for (const [x, y] of [
    [3, 9],
    [8, 12],
    [13, 8],
  ] as const) {
    put(pixels, x, y, DIRT_DARK);
  }
  return pixels;
}

function dirtTile(): Pixels {
  const pixels = createPixels(16, 16, DIRT);
  for (const [x, y] of [
    [2, 3],
    [7, 6],
    [12, 4],
    [5, 11],
    [11, 12],
    [14, 9],
  ] as const) {
    put(pixels, x, y, DIRT_DARK);
  }
  put(pixels, 4, 7, GRASS_DARK);
  return pixels;
}

function treeSprite(): Pixels {
  const pixels = createPixels(32, 32);
  rect(pixels, 14, 18, 4, 12, TRUNK);
  rect(pixels, 13, 26, 6, 3, DIRT_DARK);
  disc(pixels, 16, 13, 10, LEAF);
  disc(pixels, 12, 11, 5, LEAF_LIGHT);
  put(pixels, 18, 8, LEAF_LIGHT);
  put(pixels, 20, 14, GRASS_DARK);
  return pixels;
}

function mushroomSprite(): Pixels {
  const pixels = createPixels(16, 16);
  rect(pixels, 6, 9, 4, 5, WHITE);
  disc(pixels, 8, 7, 6, RED);
  rect(pixels, 2, 7, 12, 2, RED);
  put(pixels, 5, 5, WHITE);
  put(pixels, 6, 5, WHITE);
  put(pixels, 10, 4, WHITE);
  put(pixels, 9, 7, WHITE);
  return pixels;
}

function coinSprite(): Pixels {
  const pixels = createPixels(16, 16);
  disc(pixels, 8, 8, 6, GOLD_DARK);
  disc(pixels, 8, 8, 4, GOLD);
  put(pixels, 6, 6, WHITE);
  put(pixels, 7, 6, WHITE);
  return pixels;
}

function heartSprite(): Pixels {
  const pixels = createPixels(16, 16);
  disc(pixels, 5, 6, 3, RED);
  disc(pixels, 10, 6, 3, RED);
  rect(pixels, 3, 6, 10, 4, RED);
  for (let row = 0; row < 4; row += 1) rect(pixels, 5 + row, 10 + row, 6 - row * 2, 1, RED);
  put(pixels, 5, 5, WHITE);
  return pixels;
}

type Drawn = {
  id: string;
  title: string;
  path: string;
  category: CatalogAsset["category"];
  tags: string[];
  pixels: Pixels;
  animation?: CatalogAsset["animation"];
  collision?: CatalogAsset["collision"];
};

function drawnAssets(): Drawn[] {
  return [
    {
      id: "hero",
      title: "探险家",
      path: "characters/hero.png",
      category: "character",
      tags: ["角色", "主角", "探险家"],
      pixels: heroSheet(),
      animation: {
        frameWidth: 32,
        frameHeight: 32,
        frames: [
          { index: 0, durationMs: 240, name: "站立" },
          { index: 1, durationMs: 120, name: "走路" },
        ],
        states: { 站立: [0], 走路: [1] },
      },
      collision: { x: 10, y: 6, width: 14, height: 22 },
    },
    {
      id: "grass",
      title: "草地",
      path: "terrain/grass.png",
      category: "terrain",
      tags: ["地形", "草地", "瓦片"],
      pixels: grassTile(),
      collision: { x: 0, y: 0, width: 16, height: 16 },
    },
    {
      id: "dirt",
      title: "泥土",
      path: "terrain/dirt.png",
      category: "terrain",
      tags: ["地形", "泥土", "瓦片"],
      pixels: dirtTile(),
      collision: { x: 0, y: 0, width: 16, height: 16 },
    },
    {
      id: "tree",
      title: "大树",
      path: "props/tree.png",
      category: "prop",
      tags: ["道具", "树", "森林"],
      pixels: treeSprite(),
      collision: { x: 12, y: 16, width: 8, height: 14 },
    },
    {
      id: "mushroom",
      title: "蘑菇",
      path: "props/mushroom.png",
      category: "prop",
      tags: ["道具", "蘑菇"],
      pixels: mushroomSprite(),
      collision: { x: 2, y: 3, width: 12, height: 11 },
    },
    {
      id: "coin",
      title: "金币",
      path: "props/coin.png",
      category: "prop",
      tags: ["道具", "金币"],
      pixels: coinSprite(),
    },
    {
      id: "heart",
      title: "爱心",
      path: "ui/heart.png",
      category: "ui",
      tags: ["界面", "爱心"],
      pixels: heartSprite(),
    },
  ];
}

export async function buildForestPack(): Promise<{ manifest: AssetPack; files: Record<string, Uint8Array> }> {
  const files: Record<string, Uint8Array> = {};
  const assets: CatalogAsset[] = [];
  for (const drawn of drawnAssets()) {
    const bytes = encodePng(drawn.pixels);
    files[drawn.path] = bytes;
    assets.push({
      id: drawn.id,
      version: "1.0.0",
      title: drawn.title,
      path: drawn.path,
      mediaType: "image/png",
      width: drawn.pixels.width,
      height: drawn.pixels.height,
      ...(drawn.animation ? { animation: drawn.animation } : {}),
      ...(drawn.collision ? { collision: drawn.collision } : {}),
      tags: drawn.tags,
      theme: credit.theme,
      category: drawn.category,
      preview: drawn.path,
      license: credit.license,
      author: credit.author,
      source: credit.source,
      attribution: credit.attribution,
      sha256: await sha256Hex(bytes),
    });
  }
  const manifest: AssetPack = {
    format: "gamekit.asset-pack",
    formatVersion: 1,
    id: "forest-adventure",
    version: "1.0.0",
    title: "森林冒险",
    theme: "森林冒险",
    summary: "一套风格统一的森林素材：探险家、草地、泥土、大树、蘑菇、金币和爱心。由 GameKit 原创绘制，CC0，复制进项目后离线也能用。",
    license: credit.license,
    author: credit.author,
    source: credit.source,
    attribution: credit.attribution,
    assets,
  };
  return { manifest, files };
}

/** One catalog index for every pack that ships under public/asset-packs. */
export function catalogIndex(packs: AssetPack[]): CatalogIndex {
  return catalogIndexSchema.parse({
    format: "gamekit.asset-catalog",
    formatVersion: 1,
    packs: packs.map((pack) => ({
      id: pack.id,
      version: pack.version,
      title: pack.title,
      theme: pack.theme,
      summary: pack.summary,
      license: pack.license.spdx,
      author: pack.author,
      source: pack.source,
      attribution: pack.attribution,
      assetCount: pack.assets.length,
    })),
  });
}

export function catalogIndexFor(pack: AssetPack): CatalogIndex {
  return catalogIndex([pack]);
}
