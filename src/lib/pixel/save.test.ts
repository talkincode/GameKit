/**
 * What saving a picture into a project is allowed to do. The store does the
 * writing; this decides whether and what, so "never overwrite by accident" is a
 * tested rule and not a habit.
 */
import { describe, expect, it } from "vitest";
import type { Project } from "../project";
import { buildSpriteDocument } from "./anim";
import { createPixels } from "./buffer";
import { planAnimExample, planPixelSave } from "./save";

const OLD = new Uint8Array([1, 2, 3]);
const NEW = new Uint8Array([9, 9, 9]);

function project(): Project {
  return {
    id: "p1",
    name: "Demo",
    createdAt: 1,
    updatedAt: 1,
    files: [
      { path: "main.py", text: "print(1)" },
      { path: "assets/player.png", bytes: OLD },
    ],
    trash: [],
  };
}

describe("planPixelSave", () => {
  it("creates a new picture and keeps every other file as it was", () => {
    const base = project();
    const plan = planPixelSave(base, "p1", { path: "assets/dog.png", bytes: NEW, mode: "create" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.path).toBe("assets/dog.png");
    expect(plan.next.files.find((file) => file.path === "assets/dog.png")?.bytes).toEqual(NEW);
    expect(plan.next.files.find((file) => file.path === "assets/player.png")?.bytes).toEqual(OLD);
    expect(plan.next.files.find((file) => file.path === "main.py")?.text).toBe("print(1)");
    expect(base.files).toHaveLength(2);
  });

  it("never takes the name of a picture that already exists when creating", () => {
    const plan = planPixelSave(project(), "p1", { path: "assets/player.png", bytes: NEW, mode: "create" });
    expect(plan).toEqual({ ok: false, reason: "taken" });
  });

  it("overwrites only a picture that is there", () => {
    const plan = planPixelSave(project(), "p1", { path: "assets/player.png", bytes: NEW, mode: "overwrite" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.next.files.filter((file) => file.path === "assets/player.png")).toHaveLength(1);
    expect(plan.next.files.find((file) => file.path === "assets/player.png")?.bytes).toEqual(NEW);
    expect(planPixelSave(project(), "p1", { path: "assets/gone.png", bytes: NEW, mode: "overwrite" })).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("refuses a name that is not a PNG inside assets/", () => {
    for (const path of ["main.py", "assets/sound.wav", "player.png", "assets/../x.png", "", "assets/.png", "assets/a?b.png"]) {
      expect(planPixelSave(project(), "p1", { path, bytes: NEW, mode: "create" }), path).toEqual({
        ok: false,
        reason: "bad-path",
      });
    }
  });

  it("can overwrite a PNG that lives outside assets/, but only a PNG", () => {
    const base = project();
    base.files.push({ path: "images/hero.png", bytes: OLD }, { path: "notes.txt", text: "hi" });
    const plan = planPixelSave(base, "p1", { path: "images/hero.png", bytes: NEW, mode: "overwrite" });
    expect(plan.ok).toBe(true);
    expect(planPixelSave(base, "p1", { path: "notes.txt", bytes: NEW, mode: "overwrite" })).toEqual({
      ok: false,
      reason: "bad-path",
    });
    expect(planPixelSave(base, "p1", { path: "images/new.png", bytes: NEW, mode: "create" })).toEqual({
      ok: false,
      reason: "bad-path",
    });
  });

  it("refuses when the project is not the one the editor was opened for", () => {
    expect(planPixelSave(project(), "other", { path: "assets/dog.png", bytes: NEW, mode: "create" })).toEqual({
      ok: false,
      reason: "no-project",
    });
    expect(planPixelSave(null, "p1", { path: "assets/dog.png", bytes: NEW, mode: "create" })).toEqual({
      ok: false,
      reason: "no-project",
    });
    expect(planPixelSave(project(), null, { path: "assets/dog.png", bytes: NEW, mode: "create" })).toEqual({
      ok: false,
      reason: "no-project",
    });
  });

  it("writes the animation note with the picture, or writes neither when the note is bad", () => {
    const built = buildSpriteDocument("assets/dog.png", [{ pixels: createPixels(2, 2), durationMs: 200 }], { idle: [0] });
    expect(built).not.toBeNull();
    if (!built) return;
    const base = project();
    const plan = planPixelSave(base, "p1", {
      path: "assets/dog.png",
      bytes: NEW,
      mode: "create",
      sidecar: { path: "assets/dog.anim.json", text: built.json },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.next.files.find((file) => file.path === "assets/dog.anim.json")?.text).toBe(built.json);
    expect(plan.next.files.find((file) => file.path === "assets/player.png")?.bytes).toEqual(OLD);
    expect(base.files.map((file) => file.path)).toEqual(["main.py", "assets/player.png"]);

    expect(
      planPixelSave(project(), "p1", {
        path: "assets/dog.png",
        bytes: NEW,
        mode: "create",
        sidecar: { path: "assets/dog.anim.json", text: "{" },
      }),
    ).toEqual({ ok: false, reason: "bad-anim" });
    expect(
      planPixelSave(project(), "p1", {
        path: "assets/dog.png",
        bytes: NEW,
        mode: "create",
        sidecar: { path: "assets/other.anim.json", text: built.json },
      }),
    ).toEqual({ ok: false, reason: "bad-path" });
    const taken = project();
    taken.files.push({ path: "assets/dog.anim.json", text: "{\"keep\":true}\n" });
    expect(
      planPixelSave(taken, "p1", {
        path: "assets/dog.png",
        bytes: NEW,
        mode: "create",
        sidecar: { path: "assets/dog.anim.json", text: built.json },
      }),
    ).toEqual({ ok: false, reason: "taken" });
    expect(taken.files.find((file) => file.path === "assets/dog.anim.json")?.text).toContain("keep");
  });

  it("does not replace a helper the child already changed, and will not write a main loop that cannot run", () => {
    const base = project();
    const added = planAnimExample(base, "p1", { moduleText: "import pygame\n" });
    expect(added.ok && added.module).toBe("wrote");
    const kept = planAnimExample(
      { ...base, files: [...base.files, { path: "sprite_anim.py", text: "# mine\n" }] },
      "p1",
      { moduleText: "import pygame\n", mainText: "import asyncio\nawait asyncio.sleep(0)\n" },
    );
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(kept.module).toBe("kept");
    expect(kept.main).toBe(true);
    expect(kept.next.files.find((file) => file.path === "sprite_anim.py")?.text).toBe("# mine\n");
    expect(planAnimExample(base, "p1", { moduleText: "x", mainText: "print(1)\n" })).toEqual({ ok: false, reason: "bad-path" });
  });

  it("does not touch the file when asked to overwrite a name that differs only by case", () => {
    const plan = planPixelSave(project(), "p1", { path: "assets/Player.png", bytes: NEW, mode: "overwrite" });
    expect(plan).toEqual({ ok: false, reason: "missing" });
  });
});
