import { describe, expect, it } from "vitest";
import { assetIntroSpec, attributionView, detailActions, frameOrigin, previewScale, type SecondaryAction } from "./detail";

const RACING =
  "这些素材来自 Kenney（www.kenney.nl）的 CC0 包，使用时无需署名。GameKit 只收了原包里的一小部分。人的三帧原来宽窄不一样，这里放在同样的 16×16 透明格子里，动画编辑器才能打开。车还是原来的大小。原始包：https://kenney.nl/assets/pixel-vehicle-pack";

const FOREST = "本包由 GameKit 原创绘制，以 CC0 1.0 贡献到公共领域。使用时无需署名。不是从第三方素材站搬运的。";

const ALWAYS: SecondaryAction[] = ["try", "saveExample", "copyCode", "propose"];

describe("library detail presentation", () => {
  it("says what a character, a sound, a tileset, and a ui icon are", () => {
    expect(
      assetIntroSpec({
        category: "character",
        animation: {
          frameWidth: 32,
          frameHeight: 32,
          frames: [{ index: 0, durationMs: 200 }],
          states: { 站立: [0], 走路: [0] },
        },
      }),
    ).toEqual({ kind: "states", states: "站立、走路" });
    expect(assetIntroSpec({ category: "character", animation: { frameWidth: 16, frameHeight: 16, frames: [{ index: 0, durationMs: 100 }] } })).toEqual({
      kind: "moving",
    });
    expect(assetIntroSpec({ category: "sfx" })).toEqual({ kind: "sfx" });
    expect(assetIntroSpec({ category: "tileset" })).toEqual({ kind: "tileset" });
    expect(assetIntroSpec({ category: "ui" })).toEqual({ kind: "ui" });
    expect(assetIntroSpec({ category: "music" })).toEqual({ kind: "music" });
  });

  it("keeps the credit and parks frame notes at the bottom", () => {
    const racing = attributionView(RACING);
    expect(racing.credit).toContain("无需署名");
    expect(racing.credit).not.toContain("宽窄");
    expect(racing.technical).toContain("人的三帧原来宽窄不一样");
    expect(racing.technical).toContain("原始包");
    expect(attributionView(FOREST)).toEqual({ credit: FOREST, technical: "" });
  });

  it("shows at most two shortcuts and lists every secondary action in 更多", () => {
    const character = detailActions({ animation: { frameWidth: 32, frameHeight: 32, frames: [{ index: 0, durationMs: 100 }] }, mediaType: "image/png" });
    expect(character.shortcuts).toEqual(["openSprite"]);
    expect(character.more).toEqual(["openSprite", ...ALWAYS]);

    const sound = detailActions({ mediaType: "audio/wav" });
    expect(sound.shortcuts).toEqual(["hear"]);
    expect(sound.more).toEqual(["hear", ...ALWAYS]);
    expect(sound.more).not.toContain("openSprite");

    const tiles = detailActions({ mediaType: "image/png" });
    expect(tiles.shortcuts).toEqual([]);
    expect(tiles.more).toEqual(ALWAYS);

    const ui = detailActions({ mediaType: "image/png" });
    expect(ui.shortcuts).toEqual([]);
    expect(ui.more).toEqual(ALWAYS);

    const both = detailActions({
      animation: { frameWidth: 16, frameHeight: 16, frames: [{ index: 0, durationMs: 80 }] },
      mediaType: "audio/ogg",
    });
    expect(both.shortcuts.length).toBeLessThanOrEqual(2);
    expect(both.shortcuts).toEqual(["openSprite", "hear"]);
    for (const action of both.shortcuts) expect(both.more).toContain(action);
    for (const action of ALWAYS) expect(both.more).toContain(action);
  });

  it("finds a frame on the sheet and scales it up to a large preview", () => {
    expect(frameOrigin(64, 32, 1)).toEqual({ col: 1, row: 0 });
    expect(frameOrigin(48, 24, 2)).toEqual({ col: 0, row: 1 });
    expect(previewScale(32)).toBe(5);
    expect(previewScale(16)).toBe(8);
    expect(previewScale(64)).toBe(2);
    expect(previewScale(0)).toBe(1);
  });
});
