/**
 * Tiny PNG sprites for the built-in recipes.
 *
 * They are ordinary pictures the project stores under assets/. The games load
 * them with pygame.image.load. Nothing here is a GameKit runtime.
 */
import { createPixels, type Rgba } from "../pixel/buffer";
import { encodePng } from "../pixel/png";

const CLEAR: Rgba = [0, 0, 0, 0];

function fill(width: number, height: number, paint: (set: (x: number, y: number, color: Rgba) => void) => void): Uint8Array {
  const image = createPixels(width, height, CLEAR);
  const set = (x: number, y: number, color: Rgba) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    image.data.set(color, (y * width + x) * 4);
  };
  paint(set);
  return encodePng(image);
}

function block(set: (x: number, y: number, color: Rgba) => void, x0: number, y0: number, x1: number, y1: number, color: Rgba) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) set(x, y, color);
  }
}

export function heroSprite(): Uint8Array {
  const skin: Rgba = [239, 125, 87, 255];
  const cloth: Rgba = [56, 120, 190, 255];
  const eye: Rgba = [24, 32, 48, 255];
  return fill(16, 16, (set) => {
    block(set, 4, 1, 12, 7, skin);
    block(set, 5, 3, 7, 5, eye);
    block(set, 9, 3, 11, 5, eye);
    block(set, 3, 7, 13, 13, cloth);
    block(set, 4, 13, 7, 16, skin);
    block(set, 9, 13, 12, 16, skin);
  });
}

export function ballSprite(): Uint8Array {
  const color: Rgba = [240, 196, 72, 255];
  return fill(16, 16, (set) => {
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const dx = x - 7.5;
        const dy = y - 7.5;
        if (dx * dx + dy * dy <= 36) set(x, y, color);
      }
    }
  });
}

export function appleSprite(): Uint8Array {
  const fruit: Rgba = [214, 64, 64, 255];
  const leaf: Rgba = [56, 140, 72, 255];
  return fill(16, 16, (set) => {
    block(set, 4, 4, 12, 14, fruit);
    block(set, 7, 2, 9, 5, leaf);
  });
}

export function shipSprite(): Uint8Array {
  const hull: Rgba = [120, 190, 220, 255];
  const window: Rgba = [240, 236, 220, 255];
  return fill(16, 16, (set) => {
    block(set, 6, 2, 10, 6, window);
    block(set, 3, 6, 13, 12, hull);
    block(set, 6, 12, 10, 15, hull);
  });
}
