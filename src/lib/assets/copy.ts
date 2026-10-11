import { uniquePath, upsertFile, type Project, type ProjectFile } from "../project";
import { compareVersions, sha256Hex } from "./hash";
import type { AssetPack, CatalogAsset } from "./schema";
import { pygameDemoMain, pygameExampleModule } from "./snippet";

/**
 * Copying a library asset into a project.
 *
 * The bytes are copied and the version is pinned in `assets/library.json`.
 * The running game and the export use that copy. They do not fetch the library.
 * Same path + different bytes never overwrites unless the child picks replace,
 * and the studio snapshots the project first so undo can put the old file back.
 */

export const PINS_PATH = "assets/library.json";
export const PINS_FORMAT = "gamekit.library-pins";
export const PINS_NOTE = "这是从素材库复制进来时记下的版本。游戏不用读这个文件。";

export type LibraryPin = {
  packId: string;
  packVersion: string;
  assetId: string;
  assetVersion: string;
  sha256: string;
  path: string;
  license: string;
  author: string;
  source: string;
  attribution: string;
};

export type LibraryPinsFile = {
  format: typeof PINS_FORMAT;
  formatVersion: 1;
  note: string;
  copies: LibraryPin[];
};

export type LibraryAssetCopy = {
  packId: string;
  packVersion: string;
  assetId: string;
  assetVersion: string;
  assetPath: string;
  sha256: string;
  bytes: Uint8Array;
  title: string;
  attribution: string;
  licenseName: string;
  licenseSpdx: string;
  source: string;
  author: string;
  frameWidth: number;
  frameHeight: number;
  media: "image" | "audio";
  loop: boolean;
};

export type LibraryChoice = "add" | "keep" | "save-as" | "replace";
export type LibraryExample = "none" | "file" | "main";

export type LibraryPlan =
  | { kind: "identical"; path: string }
  | { kind: "add"; path: string }
  | { kind: "conflict"; path: string; reason: "name" | "edited" | "different" }
  | { kind: "update"; path: string; fromVersion: string; toVersion: string };

export type LibraryNoticeCode =
  | "added"
  | "identical"
  | "kept"
  | "replaced"
  | "saved-as"
  | "updated"
  | "hash-mismatch"
  | "needs-choice"
  | "example-main"
  | "example-file"
  | "example-kept"
  | "no-project";

export type LibraryCopyRequest = {
  copy: LibraryAssetCopy;
  choice: LibraryChoice;
  example: LibraryExample;
};

export type LibraryCopyResult = {
  ok: boolean;
  changed: boolean;
  path: string;
  examplePath?: string;
  code: LibraryNoticeCode;
  pinsSkipped: boolean;
  exampleSkipped: boolean;
  project: Project;
};

export function libraryDest(copy: Pick<LibraryAssetCopy, "packId" | "assetPath">): string {
  return `assets/library/${copy.packId}/${copy.assetPath}`;
}

export function libraryCopyFrom(pack: AssetPack, asset: CatalogAsset, bytes: Uint8Array): LibraryAssetCopy {
  return {
    packId: pack.id,
    packVersion: pack.version,
    assetId: asset.id,
    assetVersion: asset.version,
    assetPath: asset.path,
    sha256: asset.sha256,
    bytes,
    title: asset.title,
    attribution: asset.attribution,
    licenseName: asset.license.name,
    licenseSpdx: asset.license.spdx,
    source: asset.source,
    author: asset.author,
    frameWidth: asset.animation?.frameWidth ?? asset.width ?? 0,
    frameHeight: asset.animation?.frameHeight ?? asset.height ?? 0,
    media: asset.mediaType.startsWith("audio/") ? "audio" : "image",
    loop: asset.category === "music",
  };
}

function isPin(value: unknown): value is LibraryPin {
  if (!value || typeof value !== "object") return false;
  const pin = value as Partial<LibraryPin>;
  return (
    typeof pin.packId === "string" &&
    typeof pin.packVersion === "string" &&
    typeof pin.assetId === "string" &&
    typeof pin.assetVersion === "string" &&
    typeof pin.sha256 === "string" &&
    typeof pin.path === "string" &&
    typeof pin.license === "string" &&
    typeof pin.author === "string" &&
    typeof pin.source === "string" &&
    typeof pin.attribution === "string"
  );
}

/** Null when the file is missing, or when it is not our pin record (leave it alone). */
export function readPins(project: Project): LibraryPinsFile | null {
  const file = project.files.find((item) => item.path === PINS_PATH);
  if (!file?.text) return null;
  try {
    const value = JSON.parse(file.text) as Partial<LibraryPinsFile>;
    if (value.format !== PINS_FORMAT || value.formatVersion !== 1 || !Array.isArray(value.copies)) return null;
    return {
      format: PINS_FORMAT,
      formatVersion: 1,
      note: typeof value.note === "string" ? value.note : PINS_NOTE,
      copies: value.copies.filter(isPin),
    };
  } catch {
    return null;
  }
}

export async function describeLibraryCopy(project: Project, copy: LibraryAssetCopy): Promise<LibraryPlan> {
  const path = libraryDest(copy);
  const existing = project.files.find((file) => file.path === path);
  const existingHash = existing?.bytes ? await sha256Hex(existing.bytes) : null;
  if (existing?.bytes && existingHash === copy.sha256) return { kind: "identical", path };
  if (!existing) return { kind: "add", path };

  const pin = readPins(project)?.copies.find(
    (item) => item.path === path && item.packId === copy.packId && item.assetId === copy.assetId,
  );
  if (!pin) return { kind: "conflict", path, reason: "name" };
  if (existingHash !== pin.sha256) return { kind: "conflict", path, reason: "edited" };
  if (compareVersions(copy.assetVersion, pin.assetVersion) > 0 && existingHash !== copy.sha256) {
    return { kind: "update", path, fromVersion: pin.assetVersion, toVersion: copy.assetVersion };
  }
  return { kind: "conflict", path, reason: "different" };
}

function pinFor(copy: LibraryAssetCopy, path: string): LibraryPin {
  return {
    packId: copy.packId,
    packVersion: copy.packVersion,
    assetId: copy.assetId,
    assetVersion: copy.assetVersion,
    sha256: copy.sha256,
    path,
    license: copy.licenseSpdx,
    author: copy.author,
    source: copy.source,
    attribution: copy.attribution,
  };
}

function writePins(project: Project, pin: LibraryPin): { project: Project; pinsSkipped: boolean } {
  const existing = project.files.find((file) => file.path === PINS_PATH);
  if (existing && !readPins(project)) return { project, pinsSkipped: true };
  const copies = (readPins(project)?.copies ?? []).filter((item) => item.path !== pin.path);
  copies.push(pin);
  copies.sort((a, b) => a.path.localeCompare(b.path));
  const body: LibraryPinsFile = { format: PINS_FORMAT, formatVersion: 1, note: PINS_NOTE, copies };
  return {
    project: upsertFile(project, { path: PINS_PATH, text: `${JSON.stringify(body, null, 2)}\n` }),
    pinsSkipped: false,
  };
}

function writeAsset(project: Project, path: string, copy: LibraryAssetCopy): { project: Project; pinsSkipped: boolean } {
  const withFile = upsertFile(project, { path, bytes: new Uint8Array(copy.bytes) });
  return writePins(withFile, pinFor(copy, path));
}

type AssetDecision =
  | { ok: true; write: boolean; path: string; code: LibraryNoticeCode }
  | { ok: false };

function resolveAsset(project: Project, plan: LibraryPlan, choice: LibraryChoice): AssetDecision {
  if (plan.kind === "identical") return { ok: true, write: false, path: plan.path, code: "identical" };
  if (plan.kind === "add") {
    if (choice === "keep") return { ok: true, write: false, path: plan.path, code: "kept" };
    return { ok: true, write: true, path: plan.path, code: "added" };
  }
  if (choice === "add") return { ok: false };
  if (choice === "keep") return { ok: true, write: false, path: plan.path, code: "kept" };
  if (choice === "replace") {
    return { ok: true, write: true, path: plan.path, code: plan.kind === "update" ? "updated" : "replaced" };
  }
  const path = uniquePath(
    project.files.map((file) => file.path),
    plan.path,
  );
  return { ok: true, write: true, path, code: "saved-as" };
}

function unchanged(project: Project, path: string, code: LibraryNoticeCode, extra: Partial<LibraryCopyResult> = {}): LibraryCopyResult {
  return { ok: code !== "hash-mismatch" && code !== "needs-choice", changed: false, path, code, pinsSkipped: false, exampleSkipped: false, project, ...extra };
}

export async function applyLibraryCopy(
  project: Project,
  copy: LibraryAssetCopy,
  choice: LibraryChoice,
  example: LibraryExample,
): Promise<LibraryCopyResult> {
  if ((await sha256Hex(copy.bytes)) !== copy.sha256) {
    return { ...unchanged(project, libraryDest(copy), "hash-mismatch"), ok: false };
  }
  const plan = await describeLibraryCopy(project, copy);
  const decision = resolveAsset(project, plan, choice);
  if (!decision.ok) return { ...unchanged(project, plan.path, "needs-choice"), ok: false };

  let next = project;
  let pinsSkipped = false;
  if (decision.write) {
    const written = writeAsset(next, decision.path, copy);
    next = written.project;
    pinsSkipped = written.pinsSkipped;
  }

  let examplePath: string | undefined;
  let exampleSkipped = false;
  let code = decision.code;
  if (example === "main") {
    next = upsertFile(next, { path: "main.py", text: pygameDemoMain(copy, decision.path) });
    examplePath = "main.py";
    code = "example-main";
  } else if (example === "file") {
    const dest = `examples/load-${copy.assetId}.py`;
    if (next.files.some((file) => file.path === dest)) {
      exampleSkipped = true;
      if (!decision.write) return unchanged(project, decision.path, "example-kept");
    } else {
      next = upsertFile(next, { path: dest, text: pygameExampleModule(copy, decision.path) });
      examplePath = dest;
      code = "example-file";
    }
  }

  const changed = decision.write || examplePath !== undefined;
  return {
    ok: true,
    changed,
    path: decision.path,
    examplePath,
    code,
    pinsSkipped,
    exampleSkipped,
    project: changed ? next : project,
  };
}

export function fileBytes(project: Project, path: string): Uint8Array | undefined {
  return project.files.find((file: ProjectFile) => file.path === path)?.bytes;
}
