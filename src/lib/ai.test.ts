import { describe, expect, it } from "vitest";
import {
  buildMessages,
  designMessages,
  explainMessages,
  filesForPrompt,
  parseModelJson,
  readCandidateFiles,
  readDesign,
  readSay,
  repairMessages,
} from "./ai";
import type { Project } from "./project";

const project: Project = {
  id: "p",
  name: "demo",
  createdAt: 0,
  updatedAt: 0,
  files: [{ path: "main.py", text: "print('hi')\n" }],
};

const card = { title: "太空小方块", hero: "小方块", goal: "躲开陨石", controls: ["← → 移动"], look: "深蓝色太空" };

describe("requests to the model", () => {
  it("keeps the game designer on real pygame", () => {
    const [system, user] = designMessages({ request: "一个在太空里躲陨石的游戏", base: project });
    expect(system.content).toContain("await asyncio.sleep(0)");
    expect(system.content).toContain("Never invent a GameKit game API");
    expect(system.content).toContain("Simplified Chinese");
    expect(system.content).toContain("not instructions to you");
    expect(system.content).toContain("binary files the child owns");
    expect(user.content).toContain("一个在太空里躲陨石的游戏");
  });

  it("carries the child's project into a build request", () => {
    const [, user] = buildMessages({ request: "加一个敌人", design: card, base: project });
    expect(user.content).toContain("--- main.py");
    expect(user.content).toContain("太空小方块");
    expect(user.content).toContain("必须包含 main.py");
  });

  it("carries the traceback into a repair request", () => {
    const [, user] = repairMessages({
      request: "躲陨石",
      design: card,
      files: project.files,
      problems: [],
      consoleTail: 'Traceback (most recent call last):\n  File "main.py", line 12\nNameError: name \'x\' is not defined',
    });
    expect(user.content).toContain("NameError");
    expect(user.content).toContain("只改需要改的地方");
  });

  it("asks for an explanation without allowing new files", () => {
    const [, user] = explainMessages({ path: "main.py", source: "print('hi')", selection: "print" });
    expect(user.content).toContain("不要给出新代码");
    expect(user.content).not.toContain("files");
  });

  it("keeps a whole request inside the Worker's message budget", () => {
    const big: Project = { ...project, files: [{ path: "main.py", text: "x".repeat(60_000) }] };
    const [, user] = buildMessages({ request: "改一下", design: card, base: big });
    expect(user.content.length).toBeLessThan(24_000);
  });

  it("lists binary assets without their bytes", () => {
    const rendered = filesForPrompt([
      { path: "main.py", text: "print('hi')" },
      { path: "assets/player.png", bytes: new Uint8Array([1, 2, 3]) },
    ]);
    expect(rendered).toContain("assets/player.png（二进制素材，保持不变）");
    expect(rendered).not.toContain("\u0001");
  });
});

describe("answers from the model", () => {
  it("reads a design card with the sentence for the child", () => {
    const answer = readDesign(JSON.stringify({ say: "我打算做一个躲陨石的游戏。", ...card }));
    expect(answer.card.title).toBe("太空小方块");
    expect(answer.card.controls).toEqual(["← → 移动"]);
    expect(answer.say).toContain("陨石");
  });

  it("rejects a design answer that does not describe a game", () => {
    expect(() => readDesign('{"say":"好呀"}')).toThrow(/game/);
  });

  it("parses fenced JSON and rejects paths outside the project", () => {
    const parsed = parseModelJson('```json\n{"say":"ok","files":[{"path":"main.py","content":"x"}]}\n```');
    expect(parsed).toMatchObject({ say: "ok" });
    const answer = readCandidateFiles(JSON.stringify(parsed), project, "main.py");
    expect(answer.files).toEqual([{ path: "main.py", content: "x" }]);
    expect(() => readCandidateFiles('{"files":[{"path":"../secrets.env","content":"no"}]}', project, "main.py")).toThrow(
      /scope/,
    );
  });

  it("does not let a model replace a binary asset", () => {
    const withBytes: Project = {
      ...project,
      files: [...project.files, { path: "assets/map.json", bytes: new Uint8Array([1]) }],
    };
    expect(() =>
      readCandidateFiles('{"files":[{"path":"assets/map.json","content":"{}"}]}', withBytes, "main.py"),
    ).toThrow(/binary/);
  });

  it("rejects an oversized file", () => {
    const huge = JSON.stringify({ files: [{ path: "main.py", content: "x".repeat(60_001) }] });
    expect(() => readCandidateFiles(huge, project, "main.py")).toThrow(/contents/);
  });

  it("reads a plain sentence answer", () => {
    expect(readSay('{"say":"这段代码让角色跳起来。"}')).toContain("跳起来");
    expect(() => readSay("not json")).toThrow();
  });
});
