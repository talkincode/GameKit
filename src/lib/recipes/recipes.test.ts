import { describe, expect, it } from "vitest";
import { diagnoseProject } from "../diagnostics";
import { checkLesson, lessonFor } from "./check";
import { createRecipeProject, listRecipes, recipeIdOf } from "./catalog";
import { PLATFORM_MAIN } from "./source";

describe("recipe projects", () => {
  it("lists a playable set and never reuses a project id", () => {
    const ids = listRecipes().map((recipe) => recipe.id);
    expect(ids).toEqual(["platform", "catch", "maze", "shooter", "snake"]);
    const first = createRecipeProject("platform");
    const second = createRecipeProject("platform");
    expect(first?.id).not.toBe(second?.id);
    expect(createRecipeProject("missing")).toBeNull();
  });

  it("ships code, a picture, a design card and a visible recipe note", () => {
    for (const info of listRecipes()) {
      const project = createRecipeProject(info.id);
      expect(project).not.toBeNull();
      const main = project?.files.find((file) => file.path === "main.py")?.text ?? "";
      expect(main).toContain("await asyncio.sleep(0)");
      expect(main).toContain(`RECIPE-OK", "${info.id}"`);
      expect(main).not.toContain("time.sleep");
      expect(project?.files.some((file) => file.path.endsWith(".png") && file.bytes?.length)).toBe(true);
      expect(project?.design?.title).toBe(info.title);
      expect(recipeIdOf(project?.files ?? [])).toBe(info.id);
      expect(diagnoseProject(project!).some((problem) => problem.severity === "error")).toBe(false);
      const note = project?.files.find((file) => file.path === "README.txt")?.text ?? "";
      expect(note).toContain(info.knowledge[0]);
    }
  });
});

describe("lesson checks", () => {
  it("fails the original platform jump and passes the prepared change", () => {
    const lesson = lessonFor("platform");
    expect(lesson).not.toBeNull();
    const before = checkLesson("platform", PLATFORM_MAIN, "");
    expect(before?.ok).toBe(false);
    expect(before?.evidence).toContain("JUMP = -9");
    const after = checkLesson("platform", lesson!.suggestion.content, "");
    expect(after?.ok).toBe(true);
    expect(lesson!.suggestion.content).toContain("JUMP = -13");
    expect(lesson!.suggestion.content).toContain("await asyncio.sleep(0)");
  });

  it("fails a higher jump that blocks the browser, and a stale console marker", () => {
    const sleepy = PLATFORM_MAIN.replace("JUMP = -9", "JUMP = -13").replace(
      "screen.fill((24, 32, 48))",
      "time.sleep(1)\n        screen.fill((24, 32, 48))",
    );
    expect(checkLesson("platform", sleepy, "")?.ok).toBe(false);
    expect(checkLesson("platform", sleepy, "")?.say).toContain("卡住");

    const higher = lessonFor("platform")!.suggestion.content;
    const stale = checkLesson("platform", higher, "RECIPE-OK platform\nRECIPE-JUMP -9\n");
    expect(stale?.ok).toBe(false);
    expect(stale?.say).toContain("对不上");

    const fresh = checkLesson("platform", higher, "RECIPE-JUMP -13\n");
    expect(fresh?.ok).toBe(true);
  });

  it("fails the other recipes until the one named change, then passes", () => {
    const cases = [
      ["catch", "PADDLE = 6", "PADDLE = 10"],
      ["maze", "OPEN_GATE = False", "OPEN_GATE = True"],
      ["shooter", "COOLDOWN = 18", "COOLDOWN = 8"],
      ["snake", "STEP = 8", "STEP = 4"],
    ] as const;
    for (const [id, original, changed] of cases) {
      const project = createRecipeProject(id);
      const source = project?.files.find((file) => file.path === "main.py")?.text ?? "";
      expect(source).toContain(original);
      expect(checkLesson(id, source, "")?.ok).toBe(false);
      const suggestion = lessonFor(id)!.suggestion.content;
      expect(suggestion).toContain(changed);
      expect(checkLesson(id, suggestion, "")?.ok).toBe(true);
      expect(checkLesson(id, suggestion, "")?.evidence.length).toBeGreaterThan(0);
    }
  });

  it("does not treat a closed maze gate as success when the console still says False", () => {
    const opened = lessonFor("maze")!.suggestion.content;
    const stale = checkLesson("maze", opened, "RECIPE-GATE False\n");
    expect(stale?.ok).toBe(false);
    expect(checkLesson("maze", opened, "RECIPE-GATE True\n")?.ok).toBe(true);
  });
});
