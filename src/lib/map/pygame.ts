/**
 * Pygame that reads the same files the editor writes.
 * No GameKit import: json, csv, and pygame.image.load.
 */
import { MAP_MODULE_PATH } from "./model";

export { MAP_MODULE_PATH };

function py(value: string): string {
  return JSON.stringify(value);
}

/** A few lines the child can copy into their own game. */
export function pygameMapSnippet(documentPath: string): string {
  const path = py(documentPath);
  return `import json
info = json.load(open(${path}, encoding="utf-8"))
spawn = info["spawn"]
pixel_x = spawn["tileX"] * info["tileWidth"]
pixel_y = spawn["tileY"] * info["tileHeight"]
# 碰撞在 info["collision"] 那个 csv 里，0 能走，1 不能走
`;
}

/** Visible helper. Same rules as the snippet, plus drawing. */
export function pygameMapModule(): string {
  return `"""读取一张瓦片地图。只使用 pygame、json 和 csv，不需要 GameKit。

地图是普通文件：一份 .map.json、每一层一个 csv、碰撞一个 csv、一张瓦片 png。
格子里的 0 是空的。1 是瓦片图上的第一格，从左往右数，数完再往下。
出生点 spawn 是格子坐标，乘上 tileWidth 和 tileHeight 就是像素。
"""

import csv
import json
import pygame


def read_grid(path):
    rows = []
    with open(path, encoding="utf-8", newline="") as handle:
        for line in csv.reader(handle):
            if not line:
                continue
            rows.append([int(cell) for cell in line])
    return rows


def load_map(path):
    with open(path, encoding="utf-8") as handle:
        info = json.load(handle)
    tile_w = info["tileWidth"]
    tile_h = info["tileHeight"]
    columns = info["tileset"]["columns"]
    sheet = pygame.image.load(info["tileset"]["image"]).convert_alpha()
    tiles = [None]
    for index in range(info["tileset"]["columns"] * info["tileset"]["rows"]):
        area = pygame.Rect((index % columns) * tile_w, (index // columns) * tile_h, tile_w, tile_h)
        tiles.append(sheet.subsurface(area).copy())
    layers = []
    for layer in info["layers"]:
        layers.append({"name": layer["name"], "visible": layer.get("visible", True), "grid": read_grid(layer["csv"])})
    spawn = info["spawn"]
    return {
        "info": info,
        "tiles": tiles,
        "layers": layers,
        "collision": read_grid(info["collision"]),
        "spawn": (spawn["tileX"] * tile_w, spawn["tileY"] * tile_h),
        "objects": info.get("objects") or [],
    }


def solid_at(world, pixel_x, pixel_y):
    info = world["info"]
    x = pixel_x // info["tileWidth"]
    y = pixel_y // info["tileHeight"]
    grid = world["collision"]
    if y < 0 or x < 0 or y >= len(grid) or x >= len(grid[0]):
        return False
    return grid[y][x] == 1


def draw_map(screen, world):
    info = world["info"]
    tile_w = info["tileWidth"]
    tile_h = info["tileHeight"]
    screen.fill(pygame.Color(info["background"]))
    for layer in world["layers"]:
        if not layer["visible"]:
            continue
        for y, row in enumerate(layer["grid"]):
            for x, index in enumerate(row):
                image = world["tiles"][index] if 0 < index < len(world["tiles"]) else None
                if image:
                    screen.blit(image, (x * tile_w, y * tile_h))
    sx, sy = world["spawn"]
    pygame.draw.rect(screen, (255, 216, 74), pygame.Rect(sx, sy, tile_w, tile_h), 2)
`;
}

/** A whole main.py that draws the map and prints spawn, solids, and one tile pixel. */
export function pygameMapDemo(documentPath: string): string {
  const path = py(documentPath);
  return `import asyncio
import csv
import json
import pygame

pygame.init()
screen = pygame.display.set_mode((320, 240))
clock = pygame.time.Clock()

with open(${path}, encoding="utf-8") as handle:
    info = json.load(handle)

def read_grid(path):
    rows = []
    with open(path, encoding="utf-8", newline="") as handle:
        for line in csv.reader(handle):
            if not line:
                continue
            rows.append([int(cell) for cell in line])
    return rows

collision = read_grid(info["collision"])
solids = sum(cell for row in collision for cell in row)
spawn = info["spawn"]
tile_w = info["tileWidth"]
tile_h = info["tileHeight"]
spawn_x = spawn["tileX"] * tile_w
spawn_y = spawn["tileY"] * tile_h
tileset = pygame.image.load(info["tileset"]["image"]).convert_alpha()
sample = tileset.get_at((tile_w // 2, tile_h // 2))
objects = info.get("objects") or []
print("MAP-OK", spawn_x, spawn_y, solids)
print("MAP-TILE", sample.r, sample.g, sample.b, sample.a)
print("MAP-OBJECTS", len(objects))


def tile_image(index):
    if index <= 0:
        return None
    columns = info["tileset"]["columns"]
    i = index - 1
    area = pygame.Rect((i % columns) * tile_w, (i // columns) * tile_h, tile_w, tile_h)
    return tileset.subsurface(area)


def draw():
    screen.fill(pygame.Color(info["background"]))
    for layer in info["layers"]:
        if not layer.get("visible", True):
            continue
        grid = read_grid(layer["csv"])
        for y, row in enumerate(grid):
            for x, index in enumerate(row):
                image = tile_image(index)
                if image:
                    screen.blit(image, (x * tile_w, y * tile_h))
    pygame.draw.rect(screen, (255, 216, 74), pygame.Rect(spawn_x, spawn_y, tile_w, tile_h), 2)


async def main():
    while True:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return
        draw()
        pygame.display.flip()
        clock.tick(60)
        await asyncio.sleep(0)


asyncio.run(main())
`;
}
