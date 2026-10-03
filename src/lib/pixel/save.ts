/**
 * Decides whether a picture may be written into the project, and what the
 * project becomes. Pure: the studio store does the actual (durable) write.
 */
import { type Project, normalizePath, upsertFile } from "../project";
import { canEditPixels, imagePath } from "./rules";

export type PixelSaveInput = {
  path: string;
  bytes: Uint8Array;
  /** create never replaces a file; overwrite never makes one up. */
  mode: "create" | "overwrite";
};

export type PixelSaveFailure = "no-project" | "bad-path" | "taken" | "missing" | "write-failed";

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
  return { ok: true, path, next: upsertFile(project, { path, bytes: input.bytes }) };
}
