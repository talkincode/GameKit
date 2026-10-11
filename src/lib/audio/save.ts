/**
 * The only plan for putting a sound into a project.
 *
 * The bytes are the WAV the editor already previewed. A bad file is refused
 * before anything is written. main.py changes only when the child confirmed
 * the stage demo.
 */
import { inspectAudio } from "./format";
import { normalizePath, uniquePath, upsertFile, type Project } from "../project";

export type SoundSaveInput = {
  bytes: Uint8Array;
  suggested: string;
  /** Overwrite this path when the editor already saved it once. */
  reusePath?: string;
  /** Set only after the child confirms replacing main.py. */
  mainText?: string;
};

export type SoundSaveFailure = "no-project" | "bad-audio" | "name";

export type SoundSavePlan =
  | { ok: true; next: Project; path: string; changed: boolean }
  | { ok: false; reason: SoundSaveFailure };

export type SoundSaveResult =
  | { ok: true; path: string; changed: boolean }
  | { ok: false; reason: SoundSaveFailure | "write-failed" };

function sameBytes(project: Project, path: string, bytes: Uint8Array): boolean {
  const existing = project.files.find((file) => file.path === path)?.bytes;
  if (!existing || existing.length !== bytes.length) return false;
  for (let index = 0; index < bytes.length; index += 1) {
    if (existing[index] !== bytes[index]) return false;
  }
  return true;
}

function wavPath(value: string | null): value is string {
  return !!value && value.startsWith("assets/") && value.endsWith(".wav") && !value.includes("..");
}

export function planSoundSave(project: Project | null, input: SoundSaveInput): SoundSavePlan {
  if (!project) return { ok: false, reason: "no-project" };
  const suggested = normalizePath(input.suggested);
  if (!wavPath(suggested)) return { ok: false, reason: "name" };
  const verdict = inspectAudio(suggested, input.bytes);
  if (!verdict?.ok || verdict.format !== "wav") return { ok: false, reason: "bad-audio" };

  const reuse = input.reusePath ? normalizePath(input.reusePath) : null;
  const path = wavPath(reuse) && project.files.some((file) => file.path === reuse) ? reuse : uniquePath(project.files.map((file) => file.path), suggested);
  if (!wavPath(path)) return { ok: false, reason: "name" };

  let next = upsertFile(project, { path, bytes: new Uint8Array(input.bytes) });
  if (input.mainText !== undefined) next = upsertFile(next, { path: "main.py", text: input.mainText });

  const sameMain = input.mainText === undefined || project.files.find((file) => file.path === "main.py")?.text === input.mainText;
  if (sameBytes(project, path, input.bytes) && sameMain) return { ok: true, next: project, path, changed: false };
  return { ok: true, next, path, changed: true };
}
