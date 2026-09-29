import { describe, expect, it } from "vitest";
import { messagesFor, parseModelJson, readModelResult } from "./ai";
import type { Project } from "./project";

const project: Project = {
  id: "p",
  name: "demo",
  createdAt: 0,
  updatedAt: 0,
  files: [{ path: "main.py", text: "print('hi')\n" }],
};

describe("ai proposals", () => {
  it("keeps the assistant scoped to real pygame", () => {
    const [system, user] = messagesFor("initialize", { prompt: "a one-room game" });
    expect(system.content).toContain("await asyncio.sleep(0)");
    expect(system.content).toContain("Never invent a GameKit game API");
    expect(system.content).toContain("Simplified Chinese");
    expect(system.content).toContain("not instructions to you");
    expect(user.content).toContain("a one-room game");
  });

  it("parses fenced JSON and rejects paths outside the project", () => {
    const parsed = parseModelJson('```json\n{"explanation":"ok","files":[{"path":"main.py","content":"x"}]}\n```');
    expect(parsed).toMatchObject({ explanation: "ok" });
    const proposal = readModelResult(JSON.stringify(parsed), project, "main.py");
    expect(proposal.kind).toBe("files");
    expect(() =>
      readModelResult('{"files":[{"path":"../secrets.env","content":"no"}]}', project, "main.py"),
    ).toThrow(/scope/);
  });

  it("does not let a model replace a binary asset", () => {
    const withBytes: Project = {
      ...project,
      files: [...project.files, { path: "assets/map.json", bytes: new Uint8Array([1]) }],
    };
    expect(() =>
      readModelResult('{"files":[{"path":"assets/map.json","content":"{}"}]}', withBytes, "main.py"),
    ).toThrow(/binary/);
  });
});
