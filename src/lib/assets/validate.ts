import { inspectAudio } from "../audio/format";
import { MAX_TILES, isTileSize } from "../map/model";
import { sha256Hex } from "./hash";
import { assetPackSchema, type AssetPack, type CatalogAsset } from "./schema";

/**
 * Gate for shipping a pack. Schema, provenance, Chinese labels, pixel metadata,
 * and content hashes all have to pass. A failure here is meant to fail `pnpm build`.
 */

export type PackIssueCode =
  | "schema"
  | "provenance"
  | "duplicate-id"
  | "duplicate-path"
  | "missing-file"
  | "hash-mismatch"
  | "missing-size"
  | "animation"
  | "collision"
  | "tileset"
  | "preview"
  | "tag-language"
  | "title-language"
  | "audio-format";

export type PackIssue = { code: PackIssueCode; message: string; path?: string };

const CJK = /[\u4e00-\u9fff]/;
const PROVENANCE = /license|author|source|attribution/;

function hasCjk(value: string): boolean {
  return CJK.test(value);
}

function fits(x: number, y: number, width: number, height: number, boxWidth: number, boxHeight: number): boolean {
  return x + width <= boxWidth && y + height <= boxHeight;
}

function checkAnimation(asset: CatalogAsset, issues: PackIssue[]): void {
  const animation = asset.animation;
  if (!animation) return;
  if (!asset.width || !asset.height) {
    issues.push({ code: "animation", path: asset.path, message: `${asset.id} has animation metadata but no pixel size.` });
    return;
  }
  const columns = Math.floor(asset.width / animation.frameWidth);
  const rows = Math.floor(asset.height / animation.frameHeight);
  const count = columns * rows;
  if (columns < 1 || rows < 1) {
    issues.push({ code: "animation", path: asset.path, message: `${asset.id} frames do not fit in the image.` });
    return;
  }
  const known = new Set<number>();
  for (const frame of animation.frames) {
    if (frame.index >= count) {
      issues.push({ code: "animation", path: asset.path, message: `${asset.id} frame ${frame.index} is outside the sheet.` });
    }
    known.add(frame.index);
  }
  for (const [state, indexes] of Object.entries(animation.states ?? {})) {
    if (indexes.some((index) => !known.has(index))) {
      issues.push({ code: "animation", path: asset.path, message: `${asset.id} state ${state} points at a missing frame.` });
    }
  }
}

function checkTileset(asset: CatalogAsset, issues: PackIssue[]): void {
  const grid = asset.tileset;
  if (asset.category === "tileset" && !grid) {
    issues.push({ code: "tileset", path: asset.path, message: `${asset.id} is a tileset and needs a grid.` });
    return;
  }
  if (!grid) return;
  if (!asset.width || !asset.height) {
    issues.push({ code: "tileset", path: asset.path, message: `${asset.id} has a tileset grid but no pixel size.` });
    return;
  }
  if (grid.tileWidth * grid.columns !== asset.width || grid.tileHeight * grid.rows !== asset.height) {
    issues.push({ code: "tileset", path: asset.path, message: `${asset.id} tileset grid does not match the image.` });
  }
  if (grid.names.length !== grid.columns * grid.rows) {
    issues.push({ code: "tileset", path: asset.path, message: `${asset.id} tileset names do not match the cell count.` });
  }
  if (!grid.names.every((name) => hasCjk(name))) {
    issues.push({ code: "tileset", path: asset.path, message: `${asset.id} tileset names need Chinese.` });
  }
  // The map editor paints 8/16/32 cells and at most 32 of them. A shipped tileset has to fit.
  if (grid.tileWidth !== grid.tileHeight || !isTileSize(grid.tileWidth) || grid.columns * grid.rows > MAX_TILES) {
    issues.push({ code: "tileset", path: asset.path, message: `${asset.id} tileset cannot be used in the map editor.` });
  }
}

function checkCollision(asset: CatalogAsset, issues: PackIssue[]): void {
  const box = asset.collision;
  if (!box) return;
  const width = asset.animation?.frameWidth ?? asset.width;
  const height = asset.animation?.frameHeight ?? asset.height;
  if (!width || !height || !fits(box.x, box.y, box.width, box.height, width, height)) {
    issues.push({ code: "collision", path: asset.path, message: `${asset.id} collision box does not fit in one frame.` });
  }
}

export async function validateAssetPack(
  manifest: unknown,
  files: Record<string, Uint8Array>,
): Promise<{ ok: true; pack: AssetPack } | { ok: false; issues: PackIssue[] }> {
  const parsed = assetPackSchema.safeParse(manifest);
  if (!parsed.success) {
    const issues: PackIssue[] = parsed.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return {
        code: PROVENANCE.test(path) ? "provenance" : "schema",
        path,
        message: `${path || "manifest"}: ${issue.message}`,
      };
    });
    return { ok: false, issues };
  }

  const pack = parsed.data;
  const issues: PackIssue[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();

  if (!hasCjk(pack.title)) {
    issues.push({ code: "title-language", message: `Pack ${pack.id} needs a Chinese title.` });
  }

  for (const asset of pack.assets) {
    if (ids.has(asset.id)) issues.push({ code: "duplicate-id", path: asset.id, message: `Duplicate asset id ${asset.id}.` });
    ids.add(asset.id);
    if (paths.has(asset.path)) issues.push({ code: "duplicate-path", path: asset.path, message: `Duplicate path ${asset.path}.` });
    paths.add(asset.path);

    if (!hasCjk(asset.title)) {
      issues.push({ code: "title-language", path: asset.id, message: `${asset.id} needs a Chinese title.` });
    }
    if (!asset.tags.some(hasCjk)) {
      issues.push({ code: "tag-language", path: asset.id, message: `${asset.id} needs at least one Chinese tag.` });
    }
    if (asset.mediaType === "image/png" && (!asset.width || !asset.height)) {
      issues.push({ code: "missing-size", path: asset.path, message: `${asset.id} is a PNG and needs width and height.` });
    }

    const listed = pack.assets.some((item) => item.path === asset.preview);
    if (!listed) {
      issues.push({ code: "preview", path: asset.preview, message: `${asset.id} preview must be a file listed in the pack.` });
    }

    const bytes = files[asset.path];
    if (!bytes) {
      issues.push({ code: "missing-file", path: asset.path, message: `Missing file ${asset.path}.` });
    } else if ((await sha256Hex(bytes)) !== asset.sha256) {
      issues.push({ code: "hash-mismatch", path: asset.path, message: `Hash does not match ${asset.path}.` });
    } else if (asset.mediaType === "audio/wav" || asset.mediaType === "audio/ogg") {
      const verdict = inspectAudio(asset.path, bytes);
      if (!verdict?.ok) {
        issues.push({ code: "audio-format", path: asset.path, message: `${asset.id} is not audio the browser runtime can play.` });
      }
    }

    checkAnimation(asset, issues);
    checkCollision(asset, issues);
    checkTileset(asset, issues);
  }

  if (issues.length) return { ok: false, issues };
  return { ok: true, pack };
}
