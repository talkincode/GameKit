/**
 * The starter tileset is a normal PNG the project stores next to the map.
 * Eight solid colours, a darker edge so each cell reads as a tile.
 */
import { parseHex, type Pixels, type Rgba, createPixels, readPixel } from "../pixel/buffer";
import { STARTER_TILES } from "./model";

export const STARTER_COLUMNS = 4;
export const STARTER_ROWS = 2;

export { STARTER_TILES };

function put(pixels: Pixels, x: number, y: number, color: Rgba): void {
  const at = (y * pixels.width + x) * 4;
  pixels.data[at] = color[0];
  pixels.data[at + 1] = color[1];
  pixels.data[at + 2] = color[2];
  pixels.data[at + 3] = color[3];
}

function darken(color: Rgba): Rgba {
  return [Math.round(color[0] * 0.72), Math.round(color[1] * 0.72), Math.round(color[2] * 0.72), 255];
}

/** A 4×2 sheet. Null when the tile size is not one the editor offers. */
export function starterTileset(tile: number): Pixels | null {
  if (tile !== 8 && tile !== 16 && tile !== 32) return null;
  const pixels = createPixels(STARTER_COLUMNS * tile, STARTER_ROWS * tile);
  STARTER_TILES.forEach((swatch, index) => {
    const color = parseHex(swatch.color);
    if (!color) return;
    const edge = darken(color);
    const originX = (index % STARTER_COLUMNS) * tile;
    const originY = Math.floor(index / STARTER_COLUMNS) * tile;
    for (let y = 0; y < tile; y += 1) {
      for (let x = 0; x < tile; x += 1) {
        const border = x === 0 || y === 0 || x === tile - 1 || y === tile - 1;
        put(pixels, originX + x, originY + y, border ? edge : color);
      }
    }
  });
  return pixels;
}

/** Centre of tile 1 (the first cell). Used to prove the PNG survived a round trip. */
export function starterCenter(pixels: Pixels, tile: number): Rgba | null {
  return readPixel(pixels, Math.floor(tile / 2), Math.floor(tile / 2));
}
