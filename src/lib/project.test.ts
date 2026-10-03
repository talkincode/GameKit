import { describe, expect, it } from "vitest";
import {
  TRASH_LIMIT,
  dropFromTrash,
  emptyTrash,
  fromStored,
  normalizePath,
  restoreFile,
  toStored,
  trashFile,
  uniquePath,
  type Project,
} from "./project";
import { parseGamekitEvent } from "./messages";

describe("paths", () => {
  it("rejects traversal and keeps stable names", () => {
    expect(normalizePath("game/./player.py")).toBeNull();
    expect(normalizePath("../main.py")).toBeNull();
    expect(normalizePath("assets/player.png")).toBe("assets/player.png");
    expect(uniquePath(["assets/icon.jpg"], "assets/icon.jpg")).toBe("assets/icon-2.jpg");
  });
});

function project(files: string[]): Project {
  return {
    id: "p",
    name: "demo",
    createdAt: 0,
    updatedAt: 0,
    files: files.map((path) => ({ path, text: `# ${path}\n` })),
  };
}

describe("the trash", () => {
  it("moves a deleted file out of the project and keeps its contents", () => {
    const next = trashFile(project(["main.py", "game/enemy.py"]), "game/enemy.py");
    expect(next.files.map((file) => file.path)).toEqual(["main.py"]);
    expect(next.trash).toHaveLength(1);
    expect(next.trash?.[0].file.text).toBe("# game/enemy.py\n");
    expect(next.trash?.[0].deletedAt).toBeGreaterThan(0);
  });

  it("puts a file back where it was", () => {
    const next = restoreFile(trashFile(project(["main.py", "game/enemy.py"]), "game/enemy.py"), "game/enemy.py");
    expect(next.files.map((file) => file.path)).toEqual(["game/enemy.py", "main.py"]);
    expect(next.trash).toEqual([]);
  });

  it("restores under a free name when the path is used again", () => {
    const trashed = trashFile(project(["main.py", "game/enemy.py"]), "game/enemy.py");
    const recreated = { ...trashed, files: [...trashed.files, { path: "game/enemy.py", text: "new\n" }] };
    const back = restoreFile(recreated, "game/enemy.py");
    expect(back.files.map((file) => file.path)).toEqual(["game/enemy-2.py", "game/enemy.py", "main.py"]);
    expect(back.files.find((file) => file.path === "game/enemy.py")?.text).toBe("new\n");
  });

  it("only forgets files when asked to", () => {
    const trashed = trashFile(project(["main.py", "game/enemy.py"]), "game/enemy.py");
    expect(dropFromTrash(trashed, "game/enemy.py").trash).toEqual([]);
    expect(emptyTrash(trashed).trash).toEqual([]);
    expect(emptyTrash(project(["main.py"])).trash).toBeUndefined();
  });

  it("keeps the newest files and drops the oldest past the limit", () => {
    let current = project(Array.from({ length: TRASH_LIMIT + 2 }, (_, index) => `f${index}.py`));
    for (const file of [...current.files]) current = trashFile(current, file.path);
    expect(current.trash).toHaveLength(TRASH_LIMIT);
    expect(current.trash?.[0].file.path).toBe(`f${TRASH_LIMIT + 1}.py`);
    expect(current.trash?.some((entry) => entry.file.path === "f0.py")).toBe(false);
  });

  it("survives a round trip through storage, and older records still load", () => {
    const trashed = trashFile(project(["main.py", "assets/player.png"]), "assets/player.png");
    const stored = toStored({ ...trashed, files: [{ path: "main.py", text: "x\n" }] });
    const back = fromStored(stored);
    expect(back.trash?.[0].file.path).toBe("assets/player.png");
    expect(back.trash?.[0].file.text).toBe("# assets/player.png\n");

    const old = fromStored({ id: "p", name: "old", createdAt: 0, updatedAt: 0, files: [{ path: "main.py", text: "" }] });
    expect(old.trash).toBeUndefined();
    expect(old.design).toBeUndefined();
  });

  it("drops malformed trash entries instead of guessing", () => {
    const back = fromStored({
      id: "p",
      name: "demo",
      createdAt: 0,
      updatedAt: 0,
      files: [],
      trash: [{ file: { path: "a.py", text: "x" }, deletedAt: 5 }, { nope: true } as never],
    });
    expect(back.trash).toHaveLength(1);
    expect(back.trash?.[0].file.path).toBe("a.py");
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
