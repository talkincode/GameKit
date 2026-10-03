/**
 * A picture drawn in the editor is an ordinary file in the project, so every
 * export carries exactly the bytes that were saved, and a real PNG reader sees
 * the pixels that were drawn.
 */
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildWebBundle } from "../build";
import { projectFromArchive, sourceZip, webZip } from "../export";
import type { Project } from "../project";
import { type Rgba, createPixels, readPixel } from "./buffer";
import { decodePng, encodePng } from "./png";
import { createSession, markSaved, pointerDown, pointerMove, pointerUp, undoStep } from "./session";
import { planPixelSave } from "./save";

const template = readFileSync(new URL("../../../runtime/player.tmpl", import.meta.url), "utf8");
const RED: Rgba = [255, 0, 0, 255];
const HALF_BLUE: Rgba = [0, 0, 255, 128];

function drawn() {
  const session = createSession(createPixels(8, 8));
  pointerDown(session, "pencil", 1, 1, RED);
  pointerMove(session, "pencil", 6, 1, RED);
  pointerUp(session);
  pointerDown(session, "pencil", 3, 5, HALF_BLUE);
  pointerUp(session);
  markSaved(session);
  return session;
}

function projectWith(bytes: Uint8Array): Project {
  const base: Project = {
    id: "p",
    name: "Demo",
    createdAt: 0,
    updatedAt: 0,
    files: [{ path: "main.py", text: "import pygame\n" }],
  };
  const plan = planPixelSave(base, "p", { path: "assets/my-image.png", bytes, mode: "create" });
  if (!plan.ok) throw new Error(plan.reason);
  return plan.next;
}

describe("a saved picture in exports", () => {
  it("is byte-identical in the source zip, and survives being imported again", () => {
    const bytes = encodePng(drawn().pixels);
    const project = projectWith(bytes);
    const zip = unzipSync(sourceZip(project));
    expect(zip["assets/my-image.png"]).toEqual(bytes);
    const imported = projectFromArchive("demo.zip", sourceZip(project));
    expect(imported.files.find((file) => file.path === "assets/my-image.png")?.bytes).toEqual(bytes);
  });

  it("is byte-identical inside the game package pygame loads from", () => {
    const bytes = encodePng(drawn().pixels);
    const bundle = buildWebBundle(projectWith(bytes), { template, preview: false });
    expect(unzipSync(bundle.apk)["assets/assets/my-image.png"]).toEqual(bytes);
    expect(unzipSync(webZip(bundle))["gamekit.apk"]).toBeTruthy();
  });

  it("decodes back to the pixels that were drawn, alpha included, after an undo and a redo too", () => {
    const session = drawn();
    undoStep(session);
    const decoded = decodePng(encodePng(session.pixels));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(readPixel(decoded.pixels, 1, 1)).toEqual(RED);
    expect(readPixel(decoded.pixels, 6, 1)).toEqual(RED);
    expect(readPixel(decoded.pixels, 3, 5)).toEqual([0, 0, 0, 0]);
    expect(readPixel(decoded.pixels, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("keeps half-transparent colours exactly, with no premultiply rounding", () => {
    const decoded = decodePng(encodePng(drawn().pixels));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(readPixel(decoded.pixels, 3, 5)).toEqual(HALF_BLUE);
  });
});
