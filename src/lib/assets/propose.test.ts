import { describe, expect, it } from "vitest";
import { searchCatalog, findHit, catalogLines } from "../../../shared/catalog";
import { materializeAsset } from "./propose";
import { sha256Hex } from "./hash";
import type { LibraryAssetCopy } from "./copy";
import type { Project } from "../project";

const empty: Project = { id: "p", name: "demo", createdAt: 0, updatedAt: 0, files: [{ path: "main.py", text: "print('hi')\n" }] };

async function coin(bytes: Uint8Array): Promise<LibraryAssetCopy> {
  return {
    packId: "forest-adventure",
    packVersion: "1.0.0",
    assetId: "coin",
    assetVersion: "1.0.0",
    assetPath: "props/coin.png",
    sha256: await sha256Hex(bytes),
    bytes,
    title: "金币",
    attribution: "测试",
    licenseName: "CC0",
    licenseSpdx: "CC0-1.0",
    source: "https://github.com/talkincode/GameKit",
    author: "GameKit",
    frameWidth: 16,
    frameHeight: 16,
    media: "image",
    loop: false,
  };
}

describe("catalog search", () => {
  const hits = [
    {
      packId: "forest-adventure",
      assetId: "coin",
      title: "金币",
      path: "props/coin.png",
      mediaType: "image/png",
      category: "prop",
      theme: "森林冒险",
      tags: ["道具", "金币"],
      license: "CC0-1.0",
      author: "GameKit",
      source: "https://github.com/talkincode/GameKit",
      attribution: "测试",
    },
    {
      packId: "forest-sounds",
      assetId: "jump-sfx",
      title: "跳跃",
      path: "sounds/jump.wav",
      mediaType: "audio/wav",
      category: "sfx",
      theme: "森林冒险",
      tags: ["音效", "跳跃"],
      license: "CC0-1.0",
      author: "GameKit",
      source: "https://github.com/talkincode/GameKit",
      attribution: "测试",
    },
  ];

  it("finds a coin and does not invent a second hit", () => {
    expect(searchCatalog(hits, "金币").map((hit) => hit.assetId)).toEqual(["coin"]);
    expect(findHit(hits, "forest-adventure", "missing")).toBeNull();
    expect(catalogLines(searchCatalog(hits, "金币"))).toContain("coin");
    expect(catalogLines(searchCatalog(hits, "金币"))).not.toContain("jump-sfx");
  });
});

describe("asset proposals", () => {
  it("copies onto a new project value and leaves the original alone", async () => {
    const copy = await coin(new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]));
    const before = empty.files;
    const result = await materializeAsset(empty, copy);
    expect(result.ok).toBe(true);
    expect(empty.files).toBe(before);
    if (!result.ok) return;
    expect(result.path).toBe("assets/library/forest-adventure/props/coin.png");
    expect(result.project.files.find((file) => file.path === result.path)?.bytes).toEqual(copy.bytes);
    expect(result.project.files.some((file) => file.path === "examples/load-coin.py")).toBe(true);
    expect(result.project.files.find((file) => file.path === "main.py")?.text).toBe("print('hi')\n");
  });

  it("refuses to replace different bytes", async () => {
    const copy = await coin(new Uint8Array([9, 9, 9, 9]));
    const taken: Project = {
      ...empty,
      files: [...empty.files, { path: "assets/library/forest-adventure/props/coin.png", bytes: new Uint8Array([1, 2, 3, 4]) }],
    };
    const result = await materializeAsset(taken, copy);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("conflict");
    expect(result.project).toBe(taken);
    expect(taken.files.find((file) => file.path.endsWith("coin.png"))?.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("does not add a second copy when the bytes are already there", async () => {
    const bytes = new Uint8Array([4, 5, 6, 7]);
    const copy = await coin(bytes);
    const same: Project = {
      ...empty,
      files: [
        ...empty.files,
        { path: "assets/library/forest-adventure/props/coin.png", bytes },
        { path: "examples/load-coin.py", text: "already\n" },
        {
          path: "assets/library.json",
          text: JSON.stringify({
            format: "gamekit.library-pins",
            formatVersion: 1,
            note: "测试",
            copies: [
              {
                packId: copy.packId,
                packVersion: copy.packVersion,
                assetId: copy.assetId,
                assetVersion: copy.assetVersion,
                sha256: copy.sha256,
                path: "assets/library/forest-adventure/props/coin.png",
                license: copy.licenseSpdx,
                author: copy.author,
                source: copy.source,
                attribution: copy.attribution,
              },
            ],
          }),
        },
      ],
    };
    const result = await materializeAsset(same, copy);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("identical");
    expect(same.files.filter((file) => file.path.endsWith("coin.png"))).toHaveLength(1);
  });
});
