/**
 * A small mark so two sounds are not the same gray square.
 * The card still shows the Chinese title and the pack name; the mark is extra.
 */

export const SOUND_MARKS = ["jump", "coin", "laser", "boom", "click", "step", "door", "hit", "music", "power", "tone"] as const;

export type SoundMark = (typeof SOUND_MARKS)[number];

const BY_TAG: Record<string, SoundMark> = {
  跳跃: "jump",
  金币: "coin",
  激光: "laser",
  射击: "laser",
  爆炸: "boom",
  点击: "click",
  确认: "click",
  返回: "click",
  走路: "step",
  门: "door",
  撞击: "hit",
  音乐: "music",
  升级: "power",
};

const GENERIC = new Set(["音效", "变体", "我做的"]);

/** First specific tag wins. Generic tags like 音效 are skipped so a jump stays a jump. */
export function soundMark(tags: readonly string[]): SoundMark {
  for (const tag of tags) {
    if (GENERIC.has(tag)) continue;
    const mark = BY_TAG[tag];
    if (mark) return mark;
  }
  return "tone";
}
