/**
 * What an exported game is allowed to need.
 *
 * A source zip is the project files. It does not call GameKit or the asset
 * catalog. Desktop Python + pygame-ce can run it with no network.
 *
 * A web zip is index.html, favicon.png, and gamekit.apk. The apk is those
 * same files. index.html still loads the pygame-web runtime (see
 * docs/runtime.md). That CDN is the only online piece, and it is not GameKit
 * and not the asset catalog. The export menu says so.
 */
import { strFromU8, strToU8, unzipSync } from "fflate";
import { readPins } from "./assets/copy";
import { sha256Hex } from "./assets/hash";
import { RUNTIME } from "./build";
import { isTextPath, type Project, type ProjectFile } from "./project";

export type OfflineIssueCode =
  | "missing-file"
  | "gamekit-host"
  | "catalog-fetch"
  | "remote-load"
  | "web-origin"
  | "pin-hash"
  | "apk-mismatch";

export type OfflineIssue = { code: OfflineIssueCode; message: string; path?: string };

const GAMEKIT_HOST = "gamekit.talkincode.net";
const CATALOG_PREFIX = "/asset-packs/";
const LOAD = /pygame\.(?:image\.load|mixer\.Sound)\(\s*["']([^"']+)["']/g;

function fileBytes(file: ProjectFile): Uint8Array {
  return file.bytes ?? strToU8(file.text ?? "");
}

function fileText(file: ProjectFile): string | null {
  if (!isTextPath(file.path)) return null;
  return file.text ?? strFromU8(file.bytes ?? new Uint8Array());
}

function has(project: Project, path: string): boolean {
  return project.files.some((file) => file.path === path);
}

function requireLocal(project: Project, path: string, from: string, issues: OfflineIssue[]): void {
  if (!path || path.includes("://") || path.includes(CATALOG_PREFIX) || path.startsWith("/")) {
    issues.push({
      code: "remote-load",
      path: from,
      message: `${from} loads ${path || "an empty path"}, which is not a project file.`,
    });
    return;
  }
  if (!has(project, path)) {
    issues.push({ code: "missing-file", path, message: `${from} loads ${path}, and that file is not in the package.` });
  }
}

function referencedPaths(project: Project, issues: OfflineIssue[]): void {
  for (const file of project.files) {
    const text = fileText(file);
    if (text === null) continue;
    if (text.includes(GAMEKIT_HOST)) {
      issues.push({ code: "gamekit-host", path: file.path, message: `${file.path} mentions ${GAMEKIT_HOST}.` });
    }
    if (text.includes(CATALOG_PREFIX)) {
      issues.push({ code: "catalog-fetch", path: file.path, message: `${file.path} mentions the asset catalog.` });
    }
    for (const match of text.matchAll(LOAD)) requireLocal(project, match[1] ?? "", file.path, issues);
    if (file.path.endsWith(".map.json")) requireMap(project, file.path, text, issues);
    if (file.path.endsWith(".anim.json")) requireAnim(project, file.path, text, issues);
  }
}

function requireMap(project: Project, path: string, text: string, issues: OfflineIssue[]): void {
  let value: { format?: unknown; tileset?: { image?: unknown }; collision?: unknown; layers?: { csv?: unknown }[] };
  try {
    value = JSON.parse(text) as typeof value;
  } catch {
    return;
  }
  if (value.format !== "gamekit.map") return;
  if (typeof value.tileset?.image === "string") requireLocal(project, value.tileset.image, path, issues);
  if (typeof value.collision === "string") requireLocal(project, value.collision, path, issues);
  for (const layer of value.layers ?? []) {
    if (typeof layer.csv === "string") requireLocal(project, layer.csv, path, issues);
  }
}

function requireAnim(project: Project, path: string, text: string, issues: OfflineIssue[]): void {
  let value: { format?: unknown; image?: unknown };
  try {
    value = JSON.parse(text) as typeof value;
  } catch {
    return;
  }
  if (value.format !== "gamekit.sprite-anim") return;
  if (typeof value.image === "string") requireLocal(project, value.image, path, issues);
}

async function pinHashes(project: Project, issues: OfflineIssue[]): Promise<void> {
  const pins = readPins(project);
  if (!pins) return;
  for (const pin of pins.copies) {
    const file = project.files.find((item) => item.path === pin.path);
    if (!file?.bytes) {
      issues.push({ code: "pin-hash", path: pin.path, message: `${pin.path} is pinned but missing from the package.` });
      continue;
    }
    if ((await sha256Hex(file.bytes)) !== pin.sha256) {
      issues.push({ code: "pin-hash", path: pin.path, message: `${pin.path} does not match the pinned hash.` });
    }
  }
}

/** Source package: local files, pinned hashes, no GameKit host, no catalog. */
export async function auditExportedProject(project: Project): Promise<OfflineIssue[]> {
  const issues: OfflineIssue[] = [];
  referencedPaths(project, issues);
  await pinHashes(project, issues);
  return issues;
}

/** Web package: the same project inside the apk, and only the pygame-web runtime online. */
export async function auditWebArchive(archive: Uint8Array, project: Project): Promise<OfflineIssue[]> {
  const issues = await auditExportedProject(project);
  let outer: Record<string, Uint8Array>;
  try {
    outer = unzipSync(archive);
  } catch {
    issues.push({ code: "missing-file", message: "The web zip could not be opened." });
    return issues;
  }
  const htmlBytes = outer["index.html"];
  const apk = outer["gamekit.apk"];
  if (!htmlBytes || !apk) {
    issues.push({ code: "missing-file", message: "The web zip needs index.html and gamekit.apk." });
    return issues;
  }
  const html = strFromU8(htmlBytes);
  if (html.includes(GAMEKIT_HOST)) issues.push({ code: "gamekit-host", path: "index.html", message: "index.html mentions GameKit." });
  if (html.includes(CATALOG_PREFIX)) {
    issues.push({ code: "catalog-fetch", path: "index.html", message: "index.html mentions the asset catalog." });
  }
  const urls = [...html.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((match) => match[0]);
  if (!urls.some((url) => url.startsWith(RUNTIME.cdn))) {
    issues.push({ code: "web-origin", path: "index.html", message: "index.html does not load the documented pygame-web runtime." });
  }
  for (const url of urls) {
    if (!url.startsWith(RUNTIME.cdn)) {
      issues.push({ code: "web-origin", path: "index.html", message: `index.html loads ${url}, which is not the pygame-web runtime.` });
    }
  }

  let inner: Record<string, Uint8Array>;
  try {
    inner = unzipSync(apk);
  } catch {
    issues.push({ code: "apk-mismatch", message: "gamekit.apk could not be opened." });
    return issues;
  }
  const expected = new Set(project.files.map((file) => `assets/${file.path}`));
  for (const path of Object.keys(inner)) {
    if (!expected.has(path)) issues.push({ code: "apk-mismatch", path, message: `${path} is in the apk but not in the project.` });
  }
  for (const file of project.files) {
    const packed = inner[`assets/${file.path}`];
    const bytes = fileBytes(file);
    if (!packed) {
      issues.push({ code: "apk-mismatch", path: file.path, message: `${file.path} is missing from the apk.` });
      continue;
    }
    if ((await sha256Hex(packed)) !== (await sha256Hex(bytes))) {
      issues.push({ code: "apk-mismatch", path: file.path, message: `${file.path} in the apk does not match the project.` });
    }
  }
  return issues;
}
