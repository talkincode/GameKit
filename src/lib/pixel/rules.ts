/**
 * The rules a child's choices go through before a picture exists: how big, what
 * it is called, how far it is zoomed in. Pure, so every refusal is tested.
 */
import { normalizePath, uniquePath } from "../project";

/** One side of a new picture. Bigger pictures belong in a paint program, not a sprite editor. */
export const MAX_NEW_SIDE = 256;

/** Existing pictures may be bigger (generated backgrounds are 640×360), up to this many pixels. */
export const MAX_EDIT_PIXELS = 1024 * 1024;

/** The one-click sizes. */
export const SIZE_PRESETS = [16, 32, 48, 64] as const;

export type SizeCheck =
  | { ok: true; width: number; height: number }
  /** number: not a whole number · small: under 1 · big: over MAX_NEW_SIDE */
  | { ok: false; field: "width" | "height"; reason: "number" | "small" | "big" };

function wholeNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value !== "string" || !/^-?\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

/** Checks a width and height as the child typed them. The width is judged first. */
export function checkSize(width: unknown, height: unknown): SizeCheck {
  const sides: [number | null, "width" | "height"][] = [
    [wholeNumber(width), "width"],
    [wholeNumber(height), "height"],
  ];
  for (const [value, field] of sides) {
    if (value === null) return { ok: false, field, reason: "number" };
    if (value < 1) return { ok: false, field, reason: "small" };
    if (value > MAX_NEW_SIDE) return { ok: false, field, reason: "big" };
  }
  return { ok: true, width: sides[0][0] as number, height: sides[1][0] as number };
}

/**
 * Turns a typed name into a project path: always inside assets/, always .png.
 * Null when it cannot be a file name.
 */
export function imagePath(input: string): string | null {
  let name = input.replaceAll("\\", "/").trim().replace(/^\/+/, "");
  if (!name || /[<>:"|?*\u0000-\u001f]/.test(name)) return null;
  if (!name.startsWith("assets/")) name = `assets/${name}`;
  name = name.replace(/\.(png|jpe?g|gif|bmp|webp)$/i, "");
  const path = normalizePath(`${name}.png`);
  return path && !path.endsWith("/.png") ? path : null;
}

/** `assets/my-image.png`, or the next free number: a new picture never takes an old one's name. */
export function defaultImagePath(existing: string[]): string {
  return uniquePath(existing, "assets/my-image.png");
}

/** The biggest whole-number zoom (1…limit) at which the picture fits the box. */
export function fitScale(width: number, height: number, maxWidth: number, maxHeight: number, limit = 32): number {
  if (!(width >= 1 && height >= 1)) return 1;
  const fit = Math.floor(Math.min(maxWidth / width, maxHeight / height));
  return Number.isFinite(fit) ? Math.max(1, Math.min(limit, fit)) : 1;
}

/** The zoom levels the editor steps through: whole numbers, so every pixel stays a crisp square. */
export const ZOOMS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32] as const;

/** One step in or out. Off-list values move to the nearest step in that direction. */
export function stepZoom(scale: number, direction: 1 | -1): number {
  const candidates = ZOOMS.filter((zoom) => (direction === 1 ? zoom > scale : zoom < scale));
  if (!candidates.length) return Math.max(ZOOMS[0], Math.min(ZOOMS[ZOOMS.length - 1], scale));
  return direction === 1 ? candidates[0] : candidates[candidates.length - 1];
}

/** The zoom a picture opens at: the biggest listed one that fits the box. */
export function startZoom(width: number, height: number, maxWidth: number, maxHeight: number): number {
  const fit = fitScale(width, height, maxWidth, maxHeight, ZOOMS[ZOOMS.length - 1]);
  return [...ZOOMS].reverse().find((zoom) => zoom <= fit) ?? 1;
}

/** The box the picture may fill when the editor opens. Narrow screens stack the tools above the board. */
export function boardBudget(viewportWidth: number, viewportHeight: number): { width: number; height: number } {
  const narrow = viewportWidth <= 760;
  const width = narrow ? viewportWidth - 56 : Math.min(viewportWidth - 360, 960);
  const height = narrow ? Math.min(width, viewportHeight - 480) : viewportHeight - 260;
  return { width: Math.max(160, width), height: Math.max(160, height) };
}

/** Only PNG files get 「编辑像素」: saving writes a PNG, and it must not pose as a JPEG. */
export function canEditPixels(path: string): boolean {
  return /\.png$/i.test(path) && !path.endsWith("/.png") && path !== ".png";
}
