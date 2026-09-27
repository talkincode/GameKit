import { strToU8, unzipSync, zipSync } from "fflate";
import type { WebBundle } from "./build";
import { isTextPath, normalizePath, slugName, sortFiles, type Project, type ProjectFile } from "./project";

function bundleFiles(bundle: WebBundle): Record<string, Uint8Array> {
  return {
    "index.html": strToU8(bundle.html),
    "favicon.png": bundle.favicon,
    [`${bundle.archiveName}.apk`]: bundle.apk,
  };
}

export function webZip(bundle: WebBundle): Uint8Array {
  return zipSync(bundleFiles(bundle), { level: 0 });
}

export function staticFolderZip(bundle: WebBundle, projectName: string): Uint8Array {
  const folder = slugName(projectName);
  const files: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(bundleFiles(bundle))) files[`${folder}/${name}`] = data;
  return zipSync(files, { level: 0 });
}

export function itchZip(bundle: WebBundle): Uint8Array {
  return webZip(bundle);
}

const EMBED_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Game</title>
<style>html,body{margin:0;height:100%;background:#101214}iframe{border:0;width:100%;height:100%}</style>
</head>
<body>
<iframe src="./index.html" allow="autoplay; fullscreen; gamepad" allowfullscreen></iframe>
</body>
</html>
`;

const EMBED_README = `GameKit embed package

Host these files together. index.html is the game.
It loads pygame-ce from the pygame-web runtime and does not call GameKit.

<iframe src="./index.html" allow="autoplay; fullscreen; gamepad"></iframe>
`;

export function embedZip(bundle: WebBundle): Uint8Array {
  return zipSync(
    {
      ...bundleFiles(bundle),
      "embed.html": strToU8(EMBED_HTML),
      "README.txt": strToU8(EMBED_README),
    },
    { level: 0 },
  );
}

export function sourceZip(project: Project): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const file of project.files) files[file.path] = file.bytes ?? strToU8(file.text ?? "");
  return zipSync(files, { level: 6 });
}

const TEXT_CAP = 1_000_000;
const FILE_CAP = 8_000_000;

export function projectFromArchive(name: string, archive: Uint8Array): Project {
  const entries = unzipSync(archive);
  const paths = Object.keys(entries).filter((path) => !path.endsWith("/") && !path.split("/").includes("__MACOSX"));
  const stripped = stripSingleRoot(paths);
  const files: ProjectFile[] = [];
  for (const path of paths) {
    const next = normalizePath(stripped.get(path) ?? path);
    if (!next) continue;
    const bytes = entries[path];
    if (!bytes || bytes.byteLength > FILE_CAP) continue;
    if (isTextPath(next)) {
      const text = new TextDecoder().decode(bytes);
      if (text.length > TEXT_CAP) continue;
      files.push({ path: next, text });
    } else {
      files.push({ path: next, bytes });
    }
  }
  if (!files.length) throw new Error("The archive has no project files.");
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: name.replace(/\.zip$/i, "") || "imported",
    createdAt: now,
    updatedAt: now,
    files: sortFiles(files),
  };
}

function stripSingleRoot(paths: string[]): Map<string, string> {
  const result = new Map<string, string>();
  const tops = new Set(paths.map((path) => path.split("/")[0]));
  const root = [...tops][0] ?? "";
  const nested = paths.every((path) => path.startsWith(`${root}/`) && path.length > root.length + 1);
  const stripped = paths.map((path) => path.slice(root.length + 1));
  const use = tops.size === 1 && nested && stripped.includes("main.py");
  for (const path of paths) result.set(path, use ? path.slice(root.length + 1) : path);
  return result;
}
