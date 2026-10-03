import { designFromRecord, type DesignCard } from "./design";

export type ProjectFile = {
  path: string;
  text?: string;
  bytes?: Uint8Array;
};

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  files: ProjectFile[];
  /** The design card the child adopted (see src/lib/design.ts). */
  design?: DesignCard;
  /** Deleted files, newest first. Nothing is gone until the child empties this. */
  trash?: TrashedFile[];
};

/** A file the child deleted, kept until they empty the trash. */
export type TrashedFile = { file: ProjectFile; deletedAt: number };

/** Older deleted files fall out of the trash so a project stays small. */
export const TRASH_LIMIT = 20;

export type StoredFile = {
  path: string;
  text?: string;
  base64?: string;
};

export type StoredProject = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  files: StoredFile[];
  design?: DesignCard;
  trash?: { file: StoredFile; deletedAt: number }[];
};

const TEXT_EXTENSIONS = new Set([
  "py",
  "txt",
  "md",
  "toml",
  "json",
  "csv",
  "html",
  "css",
  "js",
  "xml",
  "svg",
  "ini",
  "cfg",
]);

export function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isTextPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(path));
}

export function normalizePath(input: string): string | null {
  const cleaned = input.replaceAll("\\", "/").trim().replace(/^\/+/, "");
  if (!cleaned || cleaned.length > 180) return null;
  const parts = cleaned.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  if (parts.some((part) => part.length > 80)) return null;
  return parts.join("/");
}

export function sortFiles(files: ProjectFile[]): ProjectFile[] {
  return [...files].sort((a, b) => a.path.localeCompare(b.path));
}

export function upsertFile(project: Project, file: ProjectFile): Project {
  const files = sortFiles([...project.files.filter((item) => item.path !== file.path), file]);
  return { ...project, files, updatedAt: Date.now() };
}

export function removeFile(project: Project, path: string): Project {
  return {
    ...project,
    files: project.files.filter((file) => file.path !== path),
    updatedAt: Date.now(),
  };
}

/**
 * Deleting moves a file to the trash: reversible, and the only deletion path in
 * the UI. `dropFromTrash` and `emptyTrash` are the irreversible ones.
 */
export function trashFile(project: Project, path: string): Project {
  const file = project.files.find((item) => item.path === path);
  if (!file) return project;
  const next = removeFile(project, path);
  const trash: TrashedFile[] = [{ file, deletedAt: Date.now() }, ...(project.trash ?? [])].slice(0, TRASH_LIMIT);
  return { ...next, trash };
}

/** Puts a trashed file back; keeps both files when the path is used again. */
export function restoreFile(project: Project, path: string): Project {
  const entry = (project.trash ?? []).find((item) => item.file.path === path);
  if (!entry) return project;
  const taken = project.files.map((file) => file.path);
  const restored = { ...entry.file, path: uniquePath(taken, entry.file.path) };
  return {
    ...project,
    files: sortFiles([...project.files, restored]),
    trash: (project.trash ?? []).filter((item) => item.file.path !== path),
    updatedAt: Date.now(),
  };
}

/** Forgets one trashed file for good. */
export function dropFromTrash(project: Project, path: string): Project {
  const trash = (project.trash ?? []).filter((item) => item.file.path !== path);
  if (trash.length === (project.trash ?? []).length) return project;
  return { ...project, trash, updatedAt: Date.now() };
}

export function emptyTrash(project: Project): Project {
  if (!project.trash?.length) return project;
  return { ...project, trash: [], updatedAt: Date.now() };
}

export function renameFile(project: Project, from: string, to: string): Project | null {
  const next = normalizePath(to);
  if (!next || next === from) return null;
  if (project.files.some((file) => file.path === next)) return null;
  return {
    ...project,
    files: sortFiles(project.files.map((file) => (file.path === from ? { ...file, path: next } : file))),
    updatedAt: Date.now(),
  };
}

export function uniquePath(paths: string[], path: string): string {
  if (!paths.includes(path)) return path;
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  const extAt = dot > slash ? dot : -1;
  const stem = extAt > 0 ? path.slice(0, extAt) : path;
  const ext = extAt > 0 ? path.slice(extAt) : "";
  let n = 2;
  while (paths.includes(`${stem}-${n}${ext}`)) n += 1;
  return `${stem}-${n}${ext}`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function toStored(project: Project): StoredProject {
  const asStored = (file: ProjectFile): StoredFile =>
    file.bytes ? { path: file.path, base64: bytesToBase64(file.bytes) } : { path: file.path, text: file.text ?? "" };
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    files: project.files.map(asStored),
    design: project.design,
    trash: project.trash?.map((entry) => ({ file: asStored(entry.file), deletedAt: entry.deletedAt })),
  };
}

export function fromStored(stored: StoredProject): Project {
  const asFile = (file: StoredFile): ProjectFile =>
    file.base64
      ? { path: file.path, bytes: base64ToBytes(file.base64) }
      : { path: file.path, text: file.text ?? "" };
  return {
    id: stored.id,
    name: stored.name,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    files: sortFiles(stored.files.map(asFile)),
    design: designFromRecord(stored.design) ?? undefined,
    // Older records have no trash; a malformed entry is dropped, not guessed at.
    trash: Array.isArray(stored.trash)
      ? stored.trash
          .filter((entry) => !!entry && typeof entry === "object" && !!entry.file?.path)
          .map((entry) => ({ file: asFile(entry.file), deletedAt: Number(entry.deletedAt) || 0 }))
      : undefined,
  };
}

export type AssetFilter = "images" | "audio" | "fonts" | "other";

export function assetFilter(path: string): AssetFilter | null {
  const ext = extensionOf(path);
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "images";
  if (["ogg", "wav", "mp3", "aiff"].includes(ext)) return "audio";
  if (["ttf", "otf", "woff", "woff2"].includes(ext)) return "fonts";
  if (ext === "py") return null;
  if (path.startsWith("assets/")) return "other";
  return null;
}

export type TreeNode = {
  name: string;
  path: string;
  file: boolean;
  children: TreeNode[];
};

export function fileTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const path of [...paths].sort()) {
    const parts = path.split("/");
    let level = root;
    let acc = "";
    parts.forEach((part, index) => {
      acc = acc ? `${acc}/${part}` : part;
      const leaf = index === parts.length - 1;
      let node = level.find((item) => item.name === part && item.file === leaf);
      if (!node) {
        node = { name: part, path: acc, file: leaf, children: [] };
        level.push(node);
      }
      if (!leaf) level = node.children;
    });
  }
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name));
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(root);
  return root;
}

export function mediaType(path: string): string {
  const ext = extensionOf(path);
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "wav") return "audio/wav";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "svg") return "image/svg+xml";
  return "application/octet-stream";
}

export function editorLanguage(path: string): string {
  const ext = extensionOf(path);
  if (ext === "py") return "python";
  if (ext === "json" || ext === "toml") return "plaintext";
  if (ext === "html") return "html";
  if (ext === "css") return "css";
  if (ext === "js") return "javascript";
  if (ext === "md") return "markdown";
  if (ext === "xml" || ext === "svg") return "xml";
  return "plaintext";
}

export function slugName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "game";
}
