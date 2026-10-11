/**
 * Decides whether a picture may be written into the project, and what the
 * project becomes. Pure: the studio store does the actual (durable) write.
 * An animation note is part of the same plan, so a bad note never leaves a
 * picture behind on its own.
 */
import { type Project, normalizePath, upsertFile } from "../project";
import { SPRITE_MODULE_PATH, animationSidecarPath, isAnimationSidecar, parseSpriteAnim } from "./anim";
import { canEditPixels, imagePath } from "./rules";

export type PixelSaveInput = {
  path: string;
  bytes: Uint8Array;
  /** create never replaces a file; overwrite never makes one up. */
  mode: "create" | "overwrite";
  /** The animation note that belongs to this picture. Omitted for a plain still. */
  sidecar?: { path: string; text: string };
};

export type PixelSaveFailure = "no-project" | "bad-path" | "taken" | "missing" | "write-failed" | "bad-anim";

export type PixelSavePlan = { ok: true; path: string; next: Project } | { ok: false; reason: Exclude<PixelSaveFailure, "write-failed"> };

export function planPixelSave(project: Project | null, openedFor: string | null, input: PixelSaveInput): PixelSavePlan {
  if (!project || !openedFor || project.id !== openedFor) return { ok: false, reason: "no-project" };
  const path = normalizePath(input.path);
  if (!path) return { ok: false, reason: "bad-path" };
  // A new picture goes in assets/; an existing PNG may live anywhere the child put it.
  if (input.mode === "create" ? imagePath(path) !== path : !canEditPixels(path)) return { ok: false, reason: "bad-path" };
  const exists = project.files.some((file) => file.path === path);
  if (input.mode === "create" && exists) return { ok: false, reason: "taken" };
  if (input.mode === "overwrite" && !exists) return { ok: false, reason: "missing" };
  const picture = upsertFile(project, { path, bytes: input.bytes });
  if (!input.sidecar) return { ok: true, path, next: picture };
  const side = normalizePath(input.sidecar.path);
  const expected = animationSidecarPath(path);
  if (!side || side !== expected || !isAnimationSidecar(side)) return { ok: false, reason: "bad-path" };
  if (input.sidecar.text.length > 200_000) return { ok: false, reason: "bad-anim" };
  const parsed = parseSpriteAnim(input.sidecar.text, path);
  if (!parsed.ok) return { ok: false, reason: "bad-anim" };
  const occupier = project.files.find((file) => file.path === side);
  if (occupier?.bytes) return { ok: false, reason: "bad-path" };
  if (input.mode === "create" && occupier) return { ok: false, reason: "taken" };
  return { ok: true, path, next: upsertFile(picture, { path: side, text: input.sidecar.text }) };
}

export type AnimExampleInput = { moduleText: string; mainText?: string };

export type AnimExampleResult =
  | { ok: true; changed: boolean; module: "wrote" | "kept" | "same"; main: boolean }
  | { ok: false; reason: "no-project" | "bad-path" | "write-failed" };

export type AnimExamplePlan =
  | { ok: true; next: Project; changed: boolean; module: "wrote" | "kept" | "same"; main: boolean }
  | { ok: false; reason: "no-project" | "bad-path" };

/** Adds the visible pygame helper, and replaces main.py only when the child asked to try the animation. */
export function planAnimExample(project: Project | null, openedFor: string | null, input: AnimExampleInput): AnimExamplePlan {
  if (!project || !openedFor || project.id !== openedFor) return { ok: false, reason: "no-project" };
  if (!input.moduleText.trim() || input.moduleText.length > 20_000) return { ok: false, reason: "bad-path" };
  if (input.mainText !== undefined && (input.mainText.length > 20_000 || !input.mainText.includes("asyncio.sleep(0)"))) {
    return { ok: false, reason: "bad-path" };
  }
  let next = project;
  let changed = false;
  let module: "wrote" | "kept" | "same" = "same";
  const existing = project.files.find((file) => file.path === SPRITE_MODULE_PATH);
  if (existing?.bytes) return { ok: false, reason: "bad-path" };
  if (!existing) {
    next = upsertFile(next, { path: SPRITE_MODULE_PATH, text: input.moduleText });
    changed = true;
    module = "wrote";
  } else if (existing.text !== input.moduleText) {
    module = "kept";
  }
  let main = false;
  if (input.mainText !== undefined) {
    const currentMain = next.files.find((file) => file.path === "main.py");
    if (currentMain?.bytes) return { ok: false, reason: "bad-path" };
    if (currentMain?.text !== input.mainText) {
      next = upsertFile(next, { path: "main.py", text: input.mainText });
      changed = true;
      main = true;
    }
  }
  return { ok: true, next, changed, module, main };
}
