import { MAX_TILES, isTileSize } from "../map/model";
import type { CatalogAsset } from "./schema";

export type EditorTileset = {
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  names: string[];
};

/**
 * A library tileset the map editor can paint with.
 * Null when the grid is missing, the cells are not 8/16/32, or there are too many.
 */
export function editorTileset(asset: CatalogAsset): EditorTileset | null {
  const grid = asset.tileset;
  if (!grid) return null;
  if (grid.tileWidth !== grid.tileHeight || !isTileSize(grid.tileWidth)) return null;
  const count = grid.columns * grid.rows;
  if (count < 1 || count > MAX_TILES || grid.names.length !== count) return null;
  if (asset.width !== grid.columns * grid.tileWidth || asset.height !== grid.rows * grid.tileHeight) return null;
  return {
    tileWidth: grid.tileWidth,
    tileHeight: grid.tileHeight,
    columns: grid.columns,
    rows: grid.rows,
    names: grid.names.slice(),
  };
}
