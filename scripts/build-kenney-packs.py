#!/usr/bin/env python3
"""Build the curated Kenney CC0 packs under public/asset-packs.

Reads unpacked Kenney zips from KENNEY_SRC (default /tmp/kenney/src).
The committed files are the source of truth for the build. This script is how
that subset was chosen: a few dozen files per theme, not the whole zip.
Sheets that the animation editor or the map editor open are assembled here.
Single pictures and sounds are copied byte for byte.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import struct
import subprocess
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "public" / "asset-packs"
SRC = Path(os.environ.get("KENNEY_SRC", "/tmp/kenney/src"))

LICENSE = {
    "spdx": "CC0-1.0",
    "name": "CC0 1.0 Universal",
    "url": "https://creativecommons.org/publicdomain/zero/1.0/legalcode",
}
AUTHOR = "Kenney"


def credit(page: str, extra: str) -> str:
    return (
        f"这些素材来自 Kenney（www.kenney.nl）的 CC0 包，使用时无需署名。"
        f"GameKit 只收了原包里的一小部分。{extra}"
        f"原始包：{page}"
    )


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_png(path: Path, width: int, height: int, rgba: bytes) -> None:
    if len(rgba) != width * height * 4:
        raise SystemExit(f"bad rgba {path}")

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw += rgba[y * stride : (y + 1) * stride]
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def load_rgba(path: Path) -> tuple[int, int, bytes]:
    probe = subprocess.check_output(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path)],
        text=True,
    ).strip()
    width_s, height_s = probe.split(",")
    width, height = int(width_s), int(height_s)
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(path), "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"])
    if len(raw) != width * height * 4:
        raise SystemExit(f"ffmpeg size {path}")
    return width, height, raw


def cell(image: tuple[int, int, bytes], tile: int, index: int, columns: int) -> bytes:
    width, _height, pixels = image
    column = index % columns
    row = index // columns
    out = bytearray(tile * tile * 4)
    for y in range(tile):
        src = ((row * tile + y) * width + column * tile) * 4
        dst = y * tile * 4
        out[dst : dst + tile * 4] = pixels[src : src + tile * 4]
    return bytes(out)


def hstrip(frames: list[bytes], tile_w: int, tile_h: int) -> tuple[int, int, bytes]:
    width = tile_w * len(frames)
    height = tile_h
    out = bytearray(width * height * 4)
    for index, frame in enumerate(frames):
        if len(frame) != tile_w * tile_h * 4:
            raise SystemExit("frame size")
        for y in range(tile_h):
            src = y * tile_w * 4
            dst = (y * width + index * tile_w) * 4
            out[dst : dst + tile_w * 4] = frame[src : src + tile_w * 4]
    return width, height, bytes(out)


def pad_frame(rgba: bytes, width: int, height: int, tile: int) -> bytes:
    """Bottom-align and center a sprite on a square cell. Empty pixels stay transparent."""
    out = bytearray(tile * tile * 4)
    ox = (tile - width) // 2
    oy = tile - height
    for y in range(height):
        for x in range(width):
            src = (y * width + x) * 4
            dst = ((oy + y) * tile + ox + x) * 4
            out[dst : dst + 4] = rgba[src : src + 4]
    return bytes(out)


def down2(rgba: bytes, width: int, height: int) -> tuple[int, int, bytes]:
    """Nearest-neighbor half size. Each 2×2 block keeps its top-left pixel."""
    nw, nh = width // 2, height // 2
    out = bytearray(nw * nh * 4)
    for y in range(nh):
        for x in range(nw):
            src = ((y * 2) * width + x * 2) * 4
            dst = (y * nw + x) * 4
            out[dst : dst + 4] = rgba[src : src + 4]
    return nw, nh, bytes(out)


def grid(cells: list[bytes], columns: int, tile: int) -> tuple[int, int, bytes]:
    rows = (len(cells) + columns - 1) // columns
    width = columns * tile
    height = rows * tile
    out = bytearray(width * height * 4)
    for index, frame in enumerate(cells):
        column = index % columns
        row = index // columns
        for y in range(tile):
            src = y * tile * 4
            dst = ((row * tile + y) * width + column * tile) * 4
            out[dst : dst + tile * 4] = frame[src : src + tile * 4]
    return width, height, bytes(out)


class Pack:
    def __init__(self, pack_id: str, title: str, theme: str, summary: str, page: str, note: str):
        self.id = pack_id
        self.title = title
        self.theme = theme
        self.summary = summary
        self.page = page
        self.attribution = credit(page, note)
        self.assets: list[dict] = []
        self.dir = ROOT / pack_id

    def add(
        self,
        asset_id: str,
        title: str,
        rel: str,
        data: bytes,
        category: str,
        tags: list[str],
        media: str = "image/png",
        width: int | None = None,
        height: int | None = None,
        animation: dict | None = None,
        collision: dict | None = None,
        tileset: dict | None = None,
    ) -> None:
        path = self.dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        entry = {
            "id": asset_id,
            "version": "1.0.0",
            "title": title,
            "path": rel,
            "mediaType": media,
            "tags": tags,
            "theme": self.theme,
            "category": category,
            "preview": rel,
            "license": LICENSE,
            "author": AUTHOR,
            "source": self.page,
            "attribution": self.attribution,
            "sha256": sha256(data),
        }
        if width and height:
            entry["width"] = width
            entry["height"] = height
        if animation:
            entry["animation"] = animation
        if collision:
            entry["collision"] = collision
        if tileset:
            entry["tileset"] = tileset
        self.assets.append(entry)

    def manifest(self) -> dict:
        return {
            "format": "gamekit.asset-pack",
            "formatVersion": 1,
            "id": self.id,
            "version": "1.0.0",
            "title": self.title,
            "theme": self.theme,
            "summary": self.summary,
            "license": LICENSE,
            "author": AUTHOR,
            "source": self.page,
            "attribution": self.attribution,
            "assets": self.assets,
        }


def anim(frame_w: int, frame_h: int, frames: list[tuple[str, int]], states: dict[str, list[int]]) -> dict:
    return {
        "frameWidth": frame_w,
        "frameHeight": frame_h,
        "frames": [{"index": index, "durationMs": duration, "name": name} for index, (name, duration) in enumerate(frames)],
        "states": states,
    }


def copy_bytes(path: Path) -> bytes:
    return path.read_bytes()


def write_hold(width: int, height: int, rgba: bytes) -> bytes:
    # Encode without a path, then the pack writer stores the bytes.
    raw_path = Path("/tmp/kenney/hold.png")
    write_png(raw_path, width, height, rgba)
    return raw_path.read_bytes()


def add_sound(pack: Pack, asset_id: str, title: str, rel: str, src: Path, tags: list[str], page: str) -> None:
    data = copy_bytes(src)
    # Per-file source stays the audio pack page, while the image pack page stays on the pack.
    path = pack.dir / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    pack.assets.append(
        {
            "id": asset_id,
            "version": "1.0.0",
            "title": title,
            "path": rel,
            "mediaType": "audio/ogg",
            "tags": tags,
            "theme": pack.theme,
            "category": "sfx",
            "preview": rel,
            "license": LICENSE,
            "author": AUTHOR,
            "source": page,
            "attribution": credit(page, "声音是 Kenney 原来的 OGG Vorbis，没有转码。"),
            "sha256": sha256(data),
        }
    )


def save_pack(pack: Pack) -> None:
    manifest = pack.manifest()
    (pack.dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


def build_platform() -> None:
    page = "https://kenney.nl/assets/pixel-platformer"
    chars = load_rgba(SRC / "pixel-platformer/Tilemap/tilemap-characters_packed.png")
    walk = anim(24, 24, [("站立", 240), ("走路", 120)], {"站立": [0], "走路": [1]})
    box = {"x": 6, "y": 4, "width": 12, "height": 18}
    pack = Pack(
        "kenney-platform",
        "平台跳跃",
        "平台跳跃",
        "绿色和蓝色小人、草地、泥土、石砖和水面，加上跳跃和脚步声。来自 Kenney 的 Pixel Platformer，CC0。",
        page,
        "小人的两帧排成了一张精灵表，动画编辑器可以直接打开。地形保持原来的 18 像素。",
    )
    for asset_id, title, rel, indices, tags in [
        ("platform-walker", "绿色小人", "characters/walker.png", (0, 1), ["角色", "主角", "跳跃"]),
        ("platform-walker-blue", "蓝色小人", "characters/walker-blue.png", (2, 3), ["角色", "跳跃", "变体"]),
    ]:
        frames = [cell(chars, 24, index, 9) for index in indices]
        width, height, rgba = hstrip(frames, 24, 24)
        pack.add(asset_id, title, rel, write_hold(width, height, rgba), "character", tags, width=width, height=height, animation=walk, collision=box)
    tiles = SRC / "pixel-platformer/Tiles"
    for asset_id, title, rel, filename, category, tags in [
        ("platform-grass", "草地", "terrain/grass.png", "tile_0016.png", "terrain", ["地形", "草地"]),
        ("platform-grass-edge", "草地边", "terrain/grass-edge.png", "tile_0017.png", "terrain", ["地形", "草地"]),
        ("platform-dirt", "泥土", "terrain/dirt.png", "tile_0004.png", "terrain", ["地形", "泥土"]),
        ("platform-stone", "石砖", "terrain/stone.png", "tile_0000.png", "terrain", ["地形", "石头"]),
        ("platform-water", "水面", "terrain/water.png", "tile_0033.png", "terrain", ["地形", "水面"]),
        ("platform-pebble", "小石块", "props/pebble.png", "tile_0007.png", "prop", ["道具", "石头"]),
        ("platform-dust", "尘土", "effects/dust.png", "tile_0008.png", "effect", ["特效", "尘土"]),
    ]:
        data = copy_bytes(tiles / filename)
        width, height, _ = load_rgba(tiles / filename)
        pack.add(asset_id, title, rel, data, category, tags, width=width, height=height)
    add_sound(pack, "platform-jump", "跳跃", "sounds/jump.ogg", SRC / "digital/Audio/phaseJump1.ogg", ["音效", "跳跃", "角色"], "https://kenney.nl/assets/digital-audio")
    add_sound(pack, "platform-step", "脚步", "sounds/step.ogg", SRC / "impact/Audio/footstep_grass_000.ogg", ["音效", "走路", "角色"], "https://kenney.nl/assets/impact-sounds")
    save_pack(pack)
    print(pack.id, len(pack.assets))


def build_dungeon() -> None:
    page = "https://kenney.nl/assets/tiny-dungeon"
    sheet = load_rgba(SRC / "tiny-dungeon/Tilemap/tilemap_packed.png")
    picked = [
        (0, "棕色地砖"),
        (1, "深色地砖"),
        (4, "灰色地砖"),
        (7, "蓝灰地砖"),
        (9, "暗色地砖"),
        (12, "砖墙"),
        (24, "石墙"),
        (36, "蓝砖"),
        (48, "木地板"),
        (60, "白花"),
        (61, "石碑"),
        (101, "木桶"),
        (102, "木箱"),
        (108, "木门"),
        (114, "旗帜"),
        (120, "木箱盖"),
    ]
    cells = [cell(sheet, 16, index, 12) for index, _name in picked]
    names = [name for _index, name in picked]
    width, height, rgba = grid(cells, 4, 16)
    pack = Pack(
        "kenney-dungeon",
        "迷宫地牢",
        "迷宫地牢",
        "16 像素的地砖、墙、门、箱子和旗帜，可以放进地图编辑器。来自 Kenney 的 Tiny Dungeon，CC0。",
        page,
        "图块按 4×4 排好，每格 16 像素，地图编辑器的调色板可以直接用。",
    )
    pack.add(
        "dungeon-tiles",
        "地牢图块",
        "tilesets/rooms.png",
        write_hold(width, height, rgba),
        "tileset",
        ["图块", "地形", "地牢"],
        width=width,
        height=height,
        tileset={"tileWidth": 16, "tileHeight": 16, "columns": 4, "rows": 4, "names": names},
    )
    singles = [
        ("dungeon-flower", "白花", "effects/flower.png", 60, "effect", ["特效", "花"]),
        ("dungeon-door", "木门", "props/door.png", 108, "prop", ["道具", "门"]),
        ("dungeon-crate", "木箱", "props/crate.png", 102, "prop", ["道具", "箱子"]),
        ("dungeon-flag", "旗帜", "props/flag.png", 114, "prop", ["道具", "旗帜"]),
    ]
    for asset_id, title, rel, index, category, tags in singles:
        frame = cell(sheet, 16, index, 12)
        pack.add(asset_id, title, rel, write_hold(16, 16, frame), category, tags, width=16, height=16)
    add_sound(pack, "dungeon-door-sfx", "开门", "sounds/door.ogg", SRC / "rpg/Audio/doorOpen_1.ogg", ["音效", "门", "地牢"], "https://kenney.nl/assets/rpg-audio")
    add_sound(pack, "dungeon-step", "石地脚步", "sounds/step.ogg", SRC / "rpg/Audio/footstep00.ogg", ["音效", "走路", "地牢"], "https://kenney.nl/assets/rpg-audio")
    save_pack(pack)
    print(pack.id, len(pack.assets))


def build_space() -> None:
    page = "https://kenney.nl/assets/pixel-shmup"
    tiles = load_rgba(SRC / "pixel-shmup/Tilemap/tiles_packed.png")
    picked = [
        (36, "草地"),
        (37, "浅草"),
        (38, "黄绿草地"),
        (40, "绿草地"),
        (42, "冰面"),
        (43, "沙地"),
        (44, "褐沙"),
        (46, "泥土"),
        (72, "木板"),
        (73, "浅木板"),
        (74, "木纹"),
        (75, "深木板"),
        (48, "黄草地"),
        (54, "深草地"),
        (66, "石地"),
        (84, "泥地"),
    ]
    cells = [cell(tiles, 16, index, 12) for index, _name in picked]
    names = [name for _index, name in picked]
    width, height, rgba = grid(cells, 4, 16)
    pack = Pack(
        "kenney-space",
        "太空射击",
        "太空射击",
        "飞船、敌机、地面图块和闪光，加上激光声。来自 Kenney 的 Pixel Shmup，CC0。",
        page,
        "地面图块按 4×4 排好，每格 16 像素，地图编辑器可以直接用。飞船是原来的 32 像素。",
    )
    pack.add(
        "space-tiles",
        "空地图块",
        "tilesets/ground.png",
        write_hold(width, height, rgba),
        "tileset",
        ["图块", "地形", "射击"],
        width=width,
        height=height,
        tileset={"tileWidth": 16, "tileHeight": 16, "columns": 4, "rows": 4, "names": names},
    )
    ships = SRC / "pixel-shmup/Ships"
    for asset_id, title, rel, filename, tags in [
        ("space-ship", "飞船", "characters/ship.png", "ship_0000.png", ["角色", "飞船", "射击"]),
        ("space-enemy", "敌机", "characters/enemy.png", "ship_0006.png", ["角色", "敌人", "射击"]),
        ("space-enemy-2", "另一艘敌机", "characters/enemy-2.png", "ship_0012.png", ["角色", "敌人", "变体"]),
    ]:
        data = copy_bytes(ships / filename)
        w, h, _ = load_rgba(ships / filename)
        pack.add(asset_id, title, rel, data, "character", tags, width=w, height=h, collision={"x": 4, "y": 4, "width": 24, "height": 24})
    for asset_id, title, rel, index, tags in [
        ("space-star", "金星", "effects/star.png", 0, ["特效", "星星"]),
        ("space-spark", "闪光", "effects/spark.png", 2, ["特效", "闪光"]),
        ("space-flare", "火花", "effects/flare.png", 4, ["特效", "火花"]),
    ]:
        frame = cell(tiles, 16, index, 12)
        pack.add(asset_id, title, rel, write_hold(16, 16, frame), "effect", tags, width=16, height=16)
    add_sound(pack, "space-laser", "激光", "sounds/laser.ogg", SRC / "digital/Audio/laser1.ogg", ["音效", "射击", "激光"], "https://kenney.nl/assets/digital-audio")
    add_sound(pack, "space-hit", "击中", "sounds/hit.ogg", SRC / "impact/Audio/impactSoft_medium_000.ogg", ["音效", "撞击", "射击"], "https://kenney.nl/assets/impact-sounds")
    save_pack(pack)
    print(pack.id, len(pack.assets))


def build_racing() -> None:
    page = "https://kenney.nl/assets/pixel-vehicle-pack"
    people = SRC / "pixel-vehicle/PNG/Characters"
    frames = []
    for name in ("man.png", "man_walk1.png", "man_walk2.png"):
        w, h, rgba = load_rgba(people / name)
        frames.append(pad_frame(rgba, w, h, 16))
    width, height, rgba = hstrip(frames, 16, 16)
    walk = anim(16, 16, [("站立", 200), ("迈步", 120), ("再迈", 120)], {"站立": [0], "走路": [1, 2]})
    pack = Pack(
        "kenney-racing",
        "竞速",
        "竞速",
        "赛车、走路的人、路障和一段公路，加上撞击声。来自 Kenney 的 Pixel Vehicle Pack，CC0。",
        page,
        "人的三帧原来宽窄不一样，这里放在同样的 16×16 透明格子里，动画编辑器才能打开。车还是原来的大小。",
    )
    pack.add(
        "racing-driver",
        "车手",
        "characters/driver.png",
        write_hold(width, height, rgba),
        "character",
        ["角色", "车手", "走路"],
        width=width,
        height=height,
        animation=walk,
        collision={"x": 4, "y": 1, "width": 8, "height": 14},
    )
    cars = SRC / "pixel-vehicle/PNG/Cars"
    for asset_id, title, rel, filename, tags in [
        ("racing-car-green", "绿色跑车", "props/car-green.png", "sports_green.png", ["道具", "赛车"]),
        ("racing-taxi", "出租车", "props/taxi.png", "taxi.png", ["道具", "赛车"]),
        ("racing-bus", "巴士", "props/bus.png", "bus.png", ["道具", "赛车"]),
        ("racing-car-red", "红色跑车", "props/car-red.png", "sports_race.png", ["道具", "赛车", "变体"]),
    ]:
        data = copy_bytes(cars / filename)
        w, h, _ = load_rgba(cars / filename)
        pack.add(asset_id, title, rel, data, "prop", tags, width=w, height=h)
    props = SRC / "pixel-vehicle/PNG/Props"
    for asset_id, title, rel, filename, category, tags in [
        ("racing-road", "公路", "terrain/road.png", "highway.png", "terrain", ["地形", "公路"]),
        ("racing-barrier", "路障", "props/barrier.png", "barrier.png", "prop", ["道具", "路障"]),
        ("racing-sign", "路牌", "props/sign.png", "sign_blue.png", "prop", ["道具", "路牌"]),
        ("racing-light", "路灯", "effects/light.png", "light.png", "effect", ["特效", "灯光"]),
    ]:
        data = copy_bytes(props / filename)
        w, h, _ = load_rgba(props / filename)
        pack.add(asset_id, title, rel, data, category, tags, width=w, height=h)
    add_sound(pack, "racing-crash", "撞击", "sounds/crash.ogg", SRC / "impact/Audio/impactMetal_light_000.ogg", ["音效", "撞击", "赛车"], "https://kenney.nl/assets/impact-sounds")
    add_sound(pack, "racing-clank", "金属声", "sounds/clank.ogg", SRC / "impact/Audio/impactPlate_light_000.ogg", ["音效", "撞击", "变体"], "https://kenney.nl/assets/impact-sounds")
    save_pack(pack)
    print(pack.id, len(pack.assets))


def build_puzzle() -> None:
    page = "https://kenney.nl/assets/sokoban"
    base = SRC / "sokoban/PNG/Default size"
    frames = []
    for name in ("player_01.png", "player_02.png", "player_03.png", "player_04.png"):
        w, h, rgba = load_rgba(base / "Player" / name)
        if (w, h) != (64, 64):
            raise SystemExit("player size")
        frames.append(rgba)
    width, height, rgba = hstrip(frames, 64, 64)
    motion = anim(64, 64, [("站立", 200), ("迈步", 140), ("侧身", 140), ("回头", 140)], {"站立": [0], "走路": [1, 2, 3]})
    picked = [
        ("Ground/ground_01.png", "地面"),
        ("Ground/ground_02.png", "深地面"),
        ("Ground/ground_03.png", "石地面"),
        ("Ground/ground_04.png", "木地面"),
        ("Blocks/block_01.png", "方块"),
        ("Blocks/block_02.png", "红方块"),
        ("Blocks/block_03.png", "蓝方块"),
        ("Blocks/block_04.png", "绿方块"),
        ("Crates/crate_02.png", "木箱"),
        ("Crates/crate_08.png", "铁箱"),
        ("Environment/environment_02.png", "墙壁"),
        ("Environment/environment_05.png", "石墙"),
        ("Ground/ground_05.png", "草地"),
        ("Ground/ground_06.png", "沙地"),
        ("Blocks/block_05.png", "黄方块"),
        ("Environment/environment_06.png", "标记"),
    ]
    cells = []
    names = []
    for rel, name in picked:
        w, h, raw = load_rgba(base / rel)
        nw, nh, small = down2(raw, w, h)
        if (nw, nh) != (32, 32):
            raise SystemExit(f"puzzle tile {rel} {nw}x{nh}")
        cells.append(small)
        names.append(name)
    tw, th, grid_rgba = grid(cells, 4, 32)
    pack = Pack(
        "kenney-puzzle",
        "益智",
        "益智",
        "推箱子的人和 32 像素的地面、方块、箱子。来自 Kenney 的 Sokoban，CC0。",
        page,
        "地图格子从原来的 64 像素缩小到 32 像素，好放进地图编辑器。人还是 64 像素，四帧排成精灵表。",
    )
    pack.add(
        "puzzle-player",
        "推箱子的人",
        "characters/player.png",
        write_hold(width, height, rgba),
        "character",
        ["角色", "益智"],
        width=width,
        height=height,
        animation=motion,
        collision={"x": 16, "y": 8, "width": 32, "height": 48},
    )
    pack.add(
        "puzzle-tiles",
        "益智图块",
        "tilesets/blocks.png",
        write_hold(tw, th, grid_rgba),
        "tileset",
        ["图块", "地形", "益智"],
        width=tw,
        height=th,
        tileset={"tileWidth": 32, "tileHeight": 32, "columns": 4, "rows": 4, "names": names},
    )
    add_sound(pack, "puzzle-place", "放好", "sounds/place.ogg", SRC / "digital/Audio/pepSound1.ogg", ["音效", "金币", "益智"], "https://kenney.nl/assets/digital-audio")
    add_sound(pack, "puzzle-ok", "完成", "sounds/ok.ogg", SRC / "interface/Audio/confirmation_001.ogg", ["音效", "界面", "益智"], "https://kenney.nl/assets/interface-sounds")
    save_pack(pack)
    print(pack.id, len(pack.assets))


def build_ui() -> None:
    page = "https://kenney.nl/assets/ui-pack"
    blue = SRC / "ui-pack/PNG/Blue/Default"
    pack = Pack(
        "kenney-ui",
        "界面",
        "界面",
        "箭头、勾、叉、星星和点击声。来自 Kenney 的 UI Pack，只要蓝色的一小套，CC0。",
        page,
        "只收了蓝色默认样式里的小图标，没有把整套颜色都放进来。",
    )
    for asset_id, title, rel, filename, tags in [
        ("ui-check", "打勾", "icons/check.png", "icon_checkmark.png", ["界面", "勾"]),
        ("ui-cross", "叉号", "icons/cross.png", "icon_cross.png", ["界面", "叉"]),
        ("ui-circle", "圆点", "icons/circle.png", "icon_circle.png", ["界面", "圆"]),
        ("ui-square", "方块", "icons/square.png", "icon_square.png", ["界面", "方块"]),
        ("ui-up", "向上", "icons/up.png", "arrow_basic_n.png", ["界面", "箭头"]),
        ("ui-right", "向右", "icons/right.png", "arrow_basic_e.png", ["界面", "箭头"]),
        ("ui-down", "向下", "icons/down.png", "arrow_basic_s.png", ["界面", "箭头"]),
        ("ui-left", "向左", "icons/left.png", "arrow_basic_w.png", ["界面", "箭头"]),
        ("ui-box", "方框", "icons/box.png", "check_square_grey.png", ["界面", "方框"]),
        ("ui-box-check", "勾选", "icons/box-check.png", "check_square_grey_checkmark.png", ["界面", "勾"]),
        ("ui-star", "星星", "icons/star.png", "star.png", ["界面", "星星"]),
    ]:
        data = copy_bytes(blue / filename)
        w, h, _ = load_rgba(blue / filename)
        pack.add(asset_id, title, rel, data, "ui", tags, width=w, height=h)
    add_sound(pack, "ui-click", "点击", "sounds/click.ogg", SRC / "interface/Audio/click_001.ogg", ["音效", "界面", "点击"], "https://kenney.nl/assets/interface-sounds")
    add_sound(pack, "ui-back", "返回", "sounds/back.ogg", SRC / "interface/Audio/back_001.ogg", ["音效", "界面", "返回"], "https://kenney.nl/assets/interface-sounds")
    save_pack(pack)
    print(pack.id, len(pack.assets))


def build_sfx() -> None:
    page = "https://kenney.nl/assets"
    # The pack source is the Kenney assets home, and each file names its own pack page.
    pack = Pack(
        "kenney-sfx",
        "音效",
        "音效",
        "跳跃、金币、激光、脚步、开门和点击。来自 Kenney 的几套 CC0 音效，都是原来的 OGG Vorbis。",
        "https://kenney.nl/assets/digital-audio",
        "这一套把几个音效包里的短声音放在一起。每条声音的来源链到它自己的原包。",
    )
    # Pack.source is one page; per-file source is set in add_sound.
    items = [
        ("sfx-jump", "跳跃", "sounds/jump.ogg", SRC / "digital/Audio/phaseJump1.ogg", ["音效", "跳跃", "平台跳跃"], "https://kenney.nl/assets/digital-audio"),
        ("sfx-jump-soft", "轻跳", "sounds/jump-soft.ogg", SRC / "digital/Audio/phaseJump2.ogg", ["音效", "跳跃", "变体"], "https://kenney.nl/assets/digital-audio"),
        ("sfx-coin", "金币", "sounds/coin.ogg", SRC / "digital/Audio/pepSound1.ogg", ["音效", "金币", "益智"], "https://kenney.nl/assets/digital-audio"),
        ("sfx-laser", "激光", "sounds/laser.ogg", SRC / "digital/Audio/laser1.ogg", ["音效", "射击", "激光"], "https://kenney.nl/assets/digital-audio"),
        ("sfx-power", "升级", "sounds/power.ogg", SRC / "digital/Audio/powerUp1.ogg", ["音效", "道具", "升级"], "https://kenney.nl/assets/digital-audio"),
        ("sfx-step", "草地脚步", "sounds/step.ogg", SRC / "impact/Audio/footstep_grass_000.ogg", ["音效", "走路", "平台跳跃"], "https://kenney.nl/assets/impact-sounds"),
        ("sfx-hit", "轻撞", "sounds/hit.ogg", SRC / "impact/Audio/impactSoft_medium_000.ogg", ["音效", "撞击"], "https://kenney.nl/assets/impact-sounds"),
        ("sfx-punch", "拳击", "sounds/punch.ogg", SRC / "impact/Audio/impactPunch_medium_000.ogg", ["音效", "撞击", "地牢"], "https://kenney.nl/assets/impact-sounds"),
        ("sfx-click", "点击", "sounds/click.ogg", SRC / "interface/Audio/click_001.ogg", ["音效", "界面", "点击"], "https://kenney.nl/assets/interface-sounds"),
        ("sfx-confirm", "确认", "sounds/confirm.ogg", SRC / "interface/Audio/confirmation_001.ogg", ["音效", "界面", "确认"], "https://kenney.nl/assets/interface-sounds"),
        ("sfx-back", "返回", "sounds/back.ogg", SRC / "interface/Audio/back_001.ogg", ["音效", "界面", "返回"], "https://kenney.nl/assets/interface-sounds"),
        ("sfx-door", "开门", "sounds/door.ogg", SRC / "rpg/Audio/doorOpen_1.ogg", ["音效", "门", "迷宫地牢"], "https://kenney.nl/assets/rpg-audio"),
        ("sfx-step-stone", "石地脚步", "sounds/step-stone.ogg", SRC / "rpg/Audio/footstep00.ogg", ["音效", "走路", "迷宫地牢"], "https://kenney.nl/assets/rpg-audio"),
        ("sfx-laser-small", "小激光", "sounds/laser-small.ogg", SRC / "scifi/Audio/laserSmall_000.ogg", ["音效", "射击", "变体"], "https://kenney.nl/assets/sci-fi-sounds"),
        ("sfx-boom", "爆炸", "sounds/boom.ogg", SRC / "scifi/Audio/lowFrequency_explosion_001.ogg", ["音效", "爆炸", "射击"], "https://kenney.nl/assets/sci-fi-sounds"),
    ]
    for asset_id, title, rel, src, tags, source in items:
        add_sound(pack, asset_id, title, rel, src, tags, source)
    # The pack-level source should name the collection, not only digital-audio.
    pack.page = "https://kenney.nl/assets"
    pack.attribution = credit(
        "https://kenney.nl/assets",
        "这一套把 Digital Audio、Impact Sounds、Interface Sounds、RPG Audio 和 Sci-fi Sounds 里的短声音放在一起。每条声音的来源链到它自己的原包。",
    )
    for asset in pack.assets:
        if asset["source"] == "https://kenney.nl/assets/digital-audio" and asset["id"] == "sfx-jump":
            pass
    # Refresh pack-level fields already copied into assets at add time. Pack attribution on the manifest uses pack.attribution at save.
    save_pack(pack)
    print(pack.id, len(pack.assets))


def write_index() -> None:
    packs = []
    for folder in sorted(p for p in ROOT.iterdir() if p.is_dir()):
        manifest_path = folder / "manifest.json"
        if not manifest_path.exists():
            continue
        manifest = json.loads(manifest_path.read_text())
        packs.append(
            {
                "id": manifest["id"],
                "version": manifest["version"],
                "title": manifest["title"],
                "theme": manifest["theme"],
                "summary": manifest["summary"],
                "license": manifest["license"]["spdx"],
                "author": manifest["author"],
                "source": manifest["source"],
                "attribution": manifest["attribution"],
                "assetCount": len(manifest["assets"]),
            }
        )
    order = {"forest-adventure": 0, "forest-sounds": 1}
    packs.sort(key=lambda item: (order.get(item["id"], 2), item["id"]))
    index = {"format": "gamekit.asset-catalog", "formatVersion": 1, "packs": packs}
    (ROOT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n")
    total = sum(item["assetCount"] for item in packs)
    print(f"index packs={len(packs)} assets={total}")


if __name__ == "__main__":
    if not SRC.is_dir():
        raise SystemExit(f"Missing Kenney sources at {SRC}")
    for name in ["kenney-platform", "kenney-dungeon", "kenney-space", "kenney-racing", "kenney-puzzle", "kenney-ui", "kenney-sfx"]:
        folder = ROOT / name
        if folder.exists():
            shutil.rmtree(folder)
    build_platform()
    build_dungeon()
    build_space()
    build_racing()
    build_puzzle()
    build_ui()
    build_sfx()
    write_index()
