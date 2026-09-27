import { describe, expect, it } from "vitest";
import { normalizePath, uniquePath } from "./project";
import { parseGamekitEvent } from "./messages";

describe("paths", () => {
  it("rejects traversal and keeps stable names", () => {
    expect(normalizePath("game/./player.py")).toBeNull();
    expect(normalizePath("../main.py")).toBeNull();
    expect(normalizePath("assets/player.png")).toBe("assets/player.png");
    expect(uniquePath(["assets/icon.jpg"], "assets/icon.jpg")).toBe("assets/icon-2.jpg");
  });
});

describe("runtime messages", () => {
  it("reads tick events from the preview bridge", () => {
    expect(parseGamekitEvent(JSON.stringify({ source: "gamekit", type: "tick", fps: 59.5, frameMs: 16 }))).toMatchObject({
      type: "tick",
      fps: 59.5,
    });
    expect(parseGamekitEvent({ source: "other" })).toBeNull();
  });
});
