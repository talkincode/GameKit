import { strToU8, zipSync } from "fflate";
import type { Project } from "./project";

export const RUNTIME = {
  version: "0.9.3",
  pybuild: "3.12",
  cdn: "https://pygame-web.github.io/cdn/0.9.3/",
  archive: "gamekit",
} as const;

const FAVICON_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIklEQVR42mOQkpH8TwlmGFwGfHr/gig8asCoAbQ1YGhmJgDvzEXHBczIAQAAAABJRU5ErkJggg==";

export const FAVICON_PNG = Uint8Array.from(atob(FAVICON_BASE64), (char) => char.charCodeAt(0));

export type WebBundle = {
  title: string;
  archiveName: string;
  html: string;
  apk: Uint8Array;
  favicon: Uint8Array;
};

export type BuildOptions = {
  template: string;
  preview: boolean;
};

function screenSize(source: string): { width: number; height: number } {
  const match = source.match(/set_mode\(\s*\(\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return { width: 800, height: 480 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/[\r\n]/g, " ");
}

export function renderPlayerHtml(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{cookiecutter\.([A-Za-z0-9_]+)\}\}/g, (token, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : token,
  );
}

export function buildWebBundle(project: Project, options: BuildOptions): WebBundle {
  const main = project.files.find((file) => file.path === "main.py")?.text ?? "";
  if (!main.trim()) throw new Error("main.py is required to build.");
  const size = screenSize(main);
  const title = escapeText((project.name || "GameKit").slice(0, 80));
  const vars: Record<string, string> = {
    cdn: RUNTIME.cdn,
    proxy: "",
    xtermjs: "0",
    width: String(size.width),
    height: String(size.height),
    ume_block: "0",
    archive: RUNTIME.archive,
    autorun: "0",
    authors: "GameKit",
    icon: "favicon.png",
    title,
    directory: RUNTIME.archive,
    spdx: "see project",
    version: RUNTIME.version,
    PYBUILD: RUNTIME.pybuild,
    comment: "",
    gamekit_debug: options.preview ? "1" : "0",
    // pygbag 只有在 can_close 为假时才注册 window.onbeforeunload
    // （pythons.js: `if (!vm.config.can_close) { window.onbeforeunload = ... }`）。
    // 那个处理只会弹出浏览器的「Leave site?」—— 游戏里没有未保存的数据，
    // 工作室的保存由 store 负责，所以预览与导出都不需要它。
    can_close: "1",
  };
  const packed: Record<string, Uint8Array> = {};
  for (const file of project.files) {
    packed[`assets/${file.path}`] = file.bytes ?? strToU8(file.text ?? "");
  }
  return {
    title,
    archiveName: RUNTIME.archive,
    html: renderPlayerHtml(options.template, vars),
    apk: zipSync(packed, { level: 6 }),
    favicon: FAVICON_PNG,
  };
}
