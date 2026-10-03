/**
 * Turning a generated picture into an asset a pygame game can blit.
 *
 * Diffusion models hand back a rectangular picture with a painted background at
 * 512–1024px. A game wants a small image with transparent pixels, sized to its
 * own grid. The three steps here – cut the flat background, trim to the subject,
 * fit to the target size with nearest-neighbour sampling – are pure functions
 * over pixel buffers, so they are unit-tested without a browser.
 */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> };

export type FitMode = "contain" | "cover";

function pixelAt(image: Pixels, index: number): [number, number, number, number] {
  const at = index * 4;
  return [image.data[at], image.data[at + 1], image.data[at + 2], image.data[at + 3]];
}

function cornerColor(image: Pixels): [number, number, number] {
  const { width, height } = image;
  const corners = [0, width - 1, (height - 1) * width, height * width - 1];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const index of corners) {
    const [cr, cg, cb] = pixelAt(image, index);
    r += cr;
    g += cg;
    b += cb;
  }
  return [r / corners.length, g / corners.length, b / corners.length];
}

function nearBackground(image: Pixels, index: number, seed: [number, number, number], tolerance: number): boolean {
  const [r, g, b, a] = pixelAt(image, index);
  if (a < 8) return true;
  const distance = Math.abs(r - seed[0]) + Math.abs(g - seed[1]) + Math.abs(b - seed[2]);
  return distance <= tolerance * 3;
}

/**
 * Removes the flat background: flood fill from the border, so a subject that
 * happens to share the background colour stays intact. Returns how much was
 * removed, which is how the dialog can admit that nothing was cut.
 */
export function cutBackground(image: Pixels, tolerance = 32): { image: Pixels; removed: number } {
  const { width, height } = image;
  const data = new Uint8ClampedArray(image.data);
  const seed = cornerColor(image);
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];

  const visit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (visited[index]) return;
    visited[index] = 1;
    if (nearBackground(image, index, seed, tolerance)) queue.push(index);
  };

  for (let x = 0; x < width; x += 1) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    visit(0, y);
    visit(width - 1, y);
  }

  let removed = 0;
  while (queue.length) {
    const index = queue.pop() as number;
    data[index * 4 + 3] = 0;
    removed += 1;
    const x = index % width;
    const y = (index - x) / width;
    visit(x - 1, y);
    visit(x + 1, y);
    visit(x, y - 1);
    visit(x, y + 1);
  }
  return { image: { width, height, data }, removed: removed / (width * height) };
}

/** Crops to the pixels that are still visible. */
export function trimToContent(image: Pixels): Pixels {
  const { width, height, data } = image;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < 8) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) return image;
  const outWidth = right - left + 1;
  const outHeight = bottom - top + 1;
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y += 1) {
    const from = ((y + top) * width + left) * 4;
    out.set(data.subarray(from, from + outWidth * 4), y * outWidth * 4);
  }
  return { width: outWidth, height: outHeight, data: out };
}

/**
 * Resizes to fit a box with nearest-neighbour sampling (crisp pixels, no blur).
 * `contain` keeps the whole subject inside the box and pads with transparent
 * pixels; `cover` fills the box and lets the edges fall off.
 */
export function fitToSize(image: Pixels, width: number, height: number, mode: FitMode = "contain"): Pixels {
  const { width: sw, height: sh, data } = image;
  const out = new Uint8ClampedArray(width * height * 4);
  if (!sw || !sh) return { width, height, data: out };
  const scale = mode === "contain" ? Math.min(width / sw, height / sh) : Math.max(width / sw, height / sh);
  const drawWidth = sw * scale;
  const drawHeight = sh * scale;
  const offsetX = (width - drawWidth) / 2;
  const offsetY = (height - drawHeight) / 2;
  for (let y = 0; y < height; y += 1) {
    const sy = Math.floor((y - offsetY) / scale);
    if (sy < 0 || sy >= sh) continue;
    for (let x = 0; x < width; x += 1) {
      const sx = Math.floor((x - offsetX) / scale);
      if (sx < 0 || sx >= sw) continue;
      const from = (sy * sw + sx) * 4;
      const to = (y * width + x) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }
  return { width, height, data: out };
}

/** What landed in the asset, for the dialog to show. */
export type PreparedAsset = { bytes: Uint8Array; width: number; height: number; cut: number };

/**
 * Decodes a generated image and turns it into a small PNG for `assets/`.
 * `cut` removes the flat background first (sprites and icons only).
 */
export async function prepareAsset(
  bytes: Uint8Array,
  mediaType: string,
  target: { width: number; height: number; mode: FitMode; cut: boolean },
): Promise<PreparedAsset> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mediaType }));
  const source = document.createElement("canvas");
  source.width = bitmap.width;
  source.height = bitmap.height;
  const sourceContext = source.getContext("2d");
  if (!sourceContext) throw new Error("This browser cannot read the generated image.");
  sourceContext.drawImage(bitmap, 0, 0);
  bitmap.close();
  let pixels: Pixels = {
    width: source.width,
    height: source.height,
    data: new Uint8ClampedArray(sourceContext.getImageData(0, 0, source.width, source.height).data),
  };

  let cut = 0;
  if (target.cut) {
    const result = cutBackground(pixels);
    pixels = trimToContent(result.image);
    cut = result.removed;
  }
  pixels = fitToSize(pixels, target.width, target.height, target.mode);

  const output = document.createElement("canvas");
  output.width = pixels.width;
  output.height = pixels.height;
  const outputContext = output.getContext("2d");
  if (!outputContext) throw new Error("This browser cannot prepare the image.");
  outputContext.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => output.toBlob((value) => resolve(value), "image/png"));
  if (!blob) throw new Error("Could not save the generated image.");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: pixels.width, height: pixels.height, cut };
}
