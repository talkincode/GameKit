import { describe, expect, it } from "vitest";
import { earlierRounds, packConversation, projectForNextRound, restoreConversation, type ConversationTurn } from "./conversation";
import type { Project } from "./project";

const saved: Project = {
  id: "p1",
  name: "demo",
  createdAt: 1,
  updatedAt: 2,
  files: [{ path: "main.py", text: "print('old')\n" }],
  design: { title: "旧游戏", hero: "点", goal: "走", controls: [], look: "灰" },
};

const card = { title: "太空小方块", hero: "方块", goal: "躲陨石", controls: ["← →"], look: "深蓝" };

function turn(patch: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    id: "t1",
    kind: "design",
    request: "做一个躲陨石的游戏",
    say: "好，先做躲陨石。",
    steps: [{ key: "design", kind: "design", status: "done" }],
    design: card,
    adopted: false,
    discarded: false,
    candidate: {
      project: { ...saved, files: [{ path: "main.py", text: "print('new')\n" }] },
      design: card,
      say: "做好了",
      repairs: 0,
      diff: [{ path: "main.py", rows: [{ kind: "add", text: "print('new')" }] }],
    },
    ...patch,
  };
}

describe("the assistant conversation", () => {
  it("keeps an unadopted candidate as the game the next sentence edits", () => {
    const next = projectForNextRound(saved, [turn()]);
    expect(next.id).toBe("p1");
    expect(next.files[0]?.text).toContain("print('new')");
    expect(next.design?.title).toBe("太空小方块");
    expect(saved.files[0]?.text).toContain("print('old')");
  });

  it("keeps editing the version on screen when the next sentence has not made one yet", () => {
    const pending = turn({ id: "t2", request: "再加一个分数", say: "", design: undefined, candidate: undefined });
    const next = projectForNextRound(saved, [turn(), pending]);
    expect(next.files[0]?.text).toContain("print('new')");
    expect(next.design?.title).toBe("太空小方块");
  });

  it("returns to the saved project after the child adopts or discards", () => {
    expect(projectForNextRound(saved, [turn({ adopted: true })]).files[0]?.text).toContain("print('old')");
    expect(projectForNextRound(saved, [turn({ discarded: true })]).design?.title).toBe("旧游戏");
  });

  it("remembers what was said, and comes back after a save", () => {
    const rounds = earlierRounds([turn(), { ...turn(), id: "t2", kind: "explain", request: "讲讲这段", answer: "这是主循环。", say: "" }]);
    expect(rounds.map((round) => round.request)).toEqual(["做一个躲陨石的游戏", "讲讲这段"]);
    expect(rounds[1]?.say).toBe("这是主循环。");

    const restored = restoreConversation(packConversation([turn()]));
    expect(restored).toHaveLength(1);
    expect(restored[0]?.request).toBe("做一个躲陨石的游戏");
    expect(restored[0]?.candidate?.project.files[0]?.text).toContain("print('new')");
    expect(restored[0]?.candidate?.diff[0]?.rows[0]?.kind).toBe("add");
    expect(restored[0]?.outcome).toEqual({ kind: "cancelled" });
  });

  it("keeps a finished round ready to adopt", () => {
    const restored = restoreConversation(packConversation([turn({ outcome: { kind: "ready" } })]));
    expect(restored[0]?.outcome).toEqual({ kind: "ready" });
  });

  it("drops a transcript that is not a list of rounds", () => {
    expect(restoreConversation({ turns: [] })).toEqual([]);
    expect(restoreConversation([{ kind: "nope" }])).toEqual([]);
  });
});
