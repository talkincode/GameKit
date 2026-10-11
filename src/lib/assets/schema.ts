import { z } from "zod";

/**
 * Versioned asset-pack manifest.
 *
 * Semantics live in this JSON (id, version, media type, size, frames, tags,
 * provenance, content hash). File names are only paths, never the source of truth.
 * `docs/roadmap.md` records this as stage A of the built-in library.
 */

const nonEmpty = z.string().trim().min(1);
const idSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const httpsUrl = z.string().regex(/^https:\/\/\S+$/);
const relativePath = z.string().regex(/^[a-z0-9][a-z0-9/_-]*\.[a-z0-9]+$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const ASSET_CATEGORIES = ["character", "terrain", "prop", "ui", "effect", "tileset"] as const;
export const MEDIA_TYPES = ["image/png", "audio/ogg", "audio/wav", "application/json"] as const;

export const licenseSchema = z.object({
  spdx: nonEmpty,
  name: nonEmpty,
  url: httpsUrl,
});

export const animationFrameSchema = z.object({
  index: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  name: nonEmpty.optional(),
});

export const animationSchema = z.object({
  frameWidth: z.number().int().positive(),
  frameHeight: z.number().int().positive(),
  frames: z.array(animationFrameSchema).min(1),
  states: z.record(z.string().trim().min(1), z.array(z.number().int().nonnegative()).min(1)).optional(),
});

export const collisionSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const catalogAssetSchema = z.object({
  id: idSchema,
  version: versionSchema,
  title: nonEmpty,
  path: relativePath,
  mediaType: z.enum(MEDIA_TYPES),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  animation: animationSchema.optional(),
  collision: collisionSchema.optional(),
  tags: z.array(nonEmpty).min(1),
  theme: nonEmpty,
  category: z.enum(ASSET_CATEGORIES),
  preview: relativePath,
  license: licenseSchema,
  author: nonEmpty,
  source: httpsUrl,
  attribution: nonEmpty,
  sha256: sha256Schema,
});

export const assetPackSchema = z.object({
  format: z.literal("gamekit.asset-pack"),
  formatVersion: z.literal(1),
  id: idSchema,
  version: versionSchema,
  title: nonEmpty,
  theme: nonEmpty,
  summary: nonEmpty,
  license: licenseSchema,
  author: nonEmpty,
  source: httpsUrl,
  attribution: nonEmpty,
  assets: z.array(catalogAssetSchema).min(1),
});

export const catalogIndexSchema = z.object({
  format: z.literal("gamekit.asset-catalog"),
  formatVersion: z.literal(1),
  packs: z
    .array(
      z.object({
        id: idSchema,
        version: versionSchema,
        title: nonEmpty,
        theme: nonEmpty,
        summary: nonEmpty,
        license: nonEmpty,
        author: nonEmpty,
        source: httpsUrl,
        attribution: nonEmpty,
        assetCount: z.number().int().positive(),
      }),
    )
    .min(1),
});

export type LicenseInfo = z.infer<typeof licenseSchema>;
export type CatalogAsset = z.infer<typeof catalogAssetSchema>;
export type AssetPack = z.infer<typeof assetPackSchema>;
export type CatalogIndex = z.infer<typeof catalogIndexSchema>;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const PACK_FORMAT = "gamekit.asset-pack" as const;
export const CATALOG_FORMAT = "gamekit.asset-catalog" as const;
