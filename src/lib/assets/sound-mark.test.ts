import { describe, expect, it } from "vitest";
import { soundMark } from "./sound-mark";

describe("sound marks", () => {
  it("picks a mark from the specific tag, not the generic 音效 tag", () => {
    expect(soundMark(["音效", "跳跃", "平台跳跃"])).toBe("jump");
    expect(soundMark(["音效", "射击", "激光"])).toBe("laser");
    expect(soundMark(["音效", "爆炸", "射击"])).toBe("boom");
    expect(soundMark(["音乐", "森林", "循环"])).toBe("music");
    expect(soundMark(["音效"])).toBe("tone");
  });
});
