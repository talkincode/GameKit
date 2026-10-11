import { describe, expect, it } from "vitest";
import { encodePng } from "../pixel/png";
import { writeMapFiles } from "./document";
import { addLayer, createMap, deleteLayer, paintLayer } from "./model";
import { pygameMapDemo, pygameMapModule } from "./pygame";
import { planMapExample, planMapSave } from "./save";
import { starterTileset } from "./tileset";
import type { Project, ProjectFile } from "../project";

function project(files: ProjectFile[] = []): Project {
  return {
    id: "p",
    name: "demo",
    createdAt: 1,
    updatedAt: 1,
    files: [{ path: "main.py", text: "print('keep')\n" }, ...files],
  };
}

function saved(slug = "level-1") {
  const sheet = starterTileset(16);
  let map = createMap({ slug, name: "第一关", columns: 10, rows: 8, tileWidth: 16, tileHeight: 16 });
  if (!sheet || !map) throw new Error("map");
  map = paintLayer(map, 0, [[1, 1]], 1) ?? map;
  const files = writeMapFiles(map, encodePng(sheet));
  if (!files) throw new Error("files");
  return { map, files, png: encodePng(sheet) };
}

describe("saving a map", () => {
  it("creates the files and leaves the rest of the project alone", () => {
    const { files } = saved();
    const plan = planMapSave(project(), "p", { mode: "create", previousPaths: [], ...files });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.next.files.find((file) => file.path === "main.py")?.text).toContain("keep");
    expect(plan.next.files.some((file) => file.path === "maps/level-1.map.json")).toBe(true);
    expect(plan.next.files.find((file) => file.path === "maps/level-1.ground.csv")?.text).toContain("1");
    expect(plan.removed).toEqual([]);
  });

  it("refuses to create over a file that is already there", () => {
    const { files } = saved();
    const taken = project([{ path: "maps/level-1.map.json", text: "{}\n" }]);
    expect(planMapSave(taken, "p", { mode: "create", previousPaths: [], ...files })).toEqual({ ok: false, reason: "taken" });
    expect(taken.files.find((file) => file.path === "maps/level-1.map.json")?.text).toBe("{}\n");
  });

  it("overwrites the same map, drops a removed layer, and will not take a stranger file", () => {
    const { files, png } = saved();
    const first = planMapSave(project(), "p", { mode: "create", previousPaths: [], ...files });
    if (!first.ok) throw new Error("create");
    let map = createMap({ slug: "level-1", name: "第一关", columns: 10, rows: 8, tileWidth: 16, tileHeight: 16 });
    map = map ? addLayer(map) : null;
    map = map ? paintLayer(map, 1, [[0, 0]], 2) ?? map : null;
    const withDecor = map ? writeMapFiles(map, png) : null;
    const added = planMapSave(first.next, "p", {
      mode: "overwrite",
      previousPaths: [files.documentPath, files.tilesetPath, ...files.texts.map((file) => file.path)],
      ...withDecor!,
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.next.files.some((file) => file.path === "maps/level-1.decor.csv")).toBe(true);
    const back = deleteLayer(map!, 1);
    const without = back ? writeMapFiles(back, png) : null;
    const removed = planMapSave(added.next, "p", {
      mode: "overwrite",
      previousPaths: [withDecor!.documentPath, withDecor!.tilesetPath, ...withDecor!.texts.map((file) => file.path)],
      ...without!,
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.removed).toEqual(["maps/level-1.decor.csv"]);
    expect(removed.next.files.some((file) => file.path === "maps/level-1.decor.csv")).toBe(false);
    expect(removed.next.files.find((file) => file.path === "main.py")?.text).toContain("keep");

    const stranger = {
      ...added.next,
      files: [...added.next.files, { path: "maps/level-1.front.csv", text: "mine\n" }],
    };
    let front = addLayer(map!);
    front = front ? addLayer(front) : null;
    const clash = front ? writeMapFiles(front, png) : null;
    expect(
      planMapSave(stranger, "p", {
        mode: "overwrite",
        previousPaths: [withDecor!.documentPath, withDecor!.tilesetPath, ...withDecor!.texts.map((file) => file.path)],
        ...clash!,
      }),
    ).toEqual({ ok: false, reason: "taken" });
    expect(stranger.files.find((file) => file.path === "maps/level-1.front.csv")?.text).toBe("mine\n");
  });

  it("rejects a missing map, a bad document, and the wrong project", () => {
    const { files } = saved();
    expect(planMapSave(project(), "p", { mode: "overwrite", previousPaths: [], ...files })).toEqual({ ok: false, reason: "missing" });
    expect(planMapSave(null, "p", { mode: "create", previousPaths: [], ...files })).toEqual({ ok: false, reason: "no-project" });
    expect(planMapSave(project(), "other", { mode: "create", previousPaths: [], ...files })).toEqual({ ok: false, reason: "no-project" });
    const bad = planMapSave(project(), "p", { mode: "create", previousPaths: [], ...files, documentText: "{" });
    expect(bad).toEqual({ ok: false, reason: "bad-map" });
    const escaped = planMapSave(project(), "p", {
      mode: "create",
      previousPaths: [],
      ...files,
      texts: [...files.texts, { path: "main.py", text: "nope" }],
    });
    expect(escaped).toEqual({ ok: false, reason: "bad-path" });
  });

  it("adds the loader without covering a different copy, and only replaces main.py on purpose", () => {
    const moduleText = pygameMapModule();
    const demo = pygameMapDemo("maps/level-1.map.json");
    const fresh = planMapExample(project(), "p", { moduleText });
    expect(fresh).toMatchObject({ ok: true, module: "wrote", main: false, changed: true });
    const kept = planMapExample(fresh.ok ? fresh.next : project(), "p", { moduleText: `${moduleText}\n# child\n` });
    expect(kept).toMatchObject({ ok: true, module: "kept", changed: false });
    if (!kept.ok) return;
    expect(kept.next.files.find((file) => file.path === "map_loader.py")?.text).toBe(moduleText);
    const tried = planMapExample(kept.next, "p", { moduleText, mainText: demo });
    expect(tried).toMatchObject({ ok: true, main: true, changed: true });
    if (!tried.ok) return;
    expect(tried.next.files.find((file) => file.path === "main.py")?.text).toContain("MAP-OK");
    expect(planMapExample(project(), "p", { moduleText, mainText: "print('no sleep')\n" })).toEqual({ ok: false, reason: "bad-path" });
  });
});
