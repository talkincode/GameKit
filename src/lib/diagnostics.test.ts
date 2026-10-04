import { describe, expect, it } from "vitest";
import { diagnoseProject, problemsFromConsole } from "./diagnostics";
import type { Project } from "./project";

function project(text: string, extra: Project["files"] = []): Project {
  return {
    id: "p",
    name: "demo",
    createdAt: 0,
    updatedAt: 0,
    files: [{ path: "main.py", text }, ...extra],
  };
}

describe("diagnoseProject", () => {
  it("requires a yielding frame loop", () => {
    const problems = diagnoseProject(project("import pygame\npygame.display.flip()\n"));
    expect(problems.some((item) => item.id === "yield")).toBe(true);
  });

  it("accepts the desktop-compatible async loop", () => {
    const problems = diagnoseProject(
      project("import asyncio\nimport pygame\npygame.display.flip()\nawait asyncio.sleep(0)\n"),
    );
    expect(problems.some((item) => item.id === "yield")).toBe(false);
  });

  it("flags blocking sleeps and desktop-only audio", () => {
    const problems = diagnoseProject(
      project("import time\ntime.sleep(1)\n", [{ path: "assets/jump.wav", bytes: new Uint8Array([1]) }]),
    );
    expect(problems.map((item) => item.id)).toEqual(expect.arrayContaining(["sleep-2", "audio-assets/jump.wav"]));
  });
});

describe("problemsFromConsole", () => {
  it("reads the last traceback frame", () => {
    const text = `boot\nTraceback (most recent call last):\n  File "/data/data/gamekit/assets/game/player.py", line 9, in update\n    boom\nNameError: name 'boom' is not defined\n`;
    const [problem] = problemsFromConsole(text);
    expect(problem.path).toBe("game/player.py");
    expect(problem.line).toBe(9);
    expect(problem.message).toContain("NameError");
  });
  it("reads a syntax error even when Python omits the traceback header", () => {
    const [problem] = problemsFromConsole('  File "main.py", line 1\nSyntaxError: invalid syntax');
    expect(problem).toMatchObject({
      id: expect.stringContaining("runtime-main.py-1"),
      severity: "error",
      path: "main.py",
      line: 1,
      message: "SyntaxError: invalid syntax",
    });
  });
});
