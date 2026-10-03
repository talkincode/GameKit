/**
 * Opens a picture for editing. The pure PNG reader handles ordinary PNGs exactly;
 * anything else the browser can show (an interlaced PNG, a photo someone renamed)
 * goes through a canvas. Saving always writes a plain 8-bit RGBA PNG.
 */
import { MAX_EDIT_PIXELS } from "./rules";
import type { Pixels } from "./buffer";
import { decodePng } from "./png";

export type LoadResult = { ok: true; pixels: Pixels } | { ok: false; problem: "too-big" | "unreadable" };

async function decodeWithBrowser(bytes: Uint8Array): Promise<LoadResult> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
    if (bitmap.width * bitmap.height > MAX_EDIT_PIXELS) {
      bitmap.close();
      return { ok: false, problem: "too-big" };
    }
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return { ok: false, problem: "unreadable" };
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return { ok: true, pixels: { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) } };
  } catch {
    return { ok: false, problem: "unreadable" };
  }
}

export async function loadPixels(bytes: Uint8Array): Promise<LoadResult> {
  const decoded = decodePng(bytes, MAX_EDIT_PIXELS);
  if (decoded.ok) return { ok: true, pixels: decoded.pixels };
  if (decoded.problem === "too-big") return { ok: false, problem: "too-big" };
  return decodeWithBrowser(bytes);
}
