import { strToU8, zipSync } from "fflate";
import type { Project } from "./project";

export const RUNTIME = {
  version: "0.9.3",
  pybuild: "3.12",
  cdn: "https://pygame-web.github.io/cdn/0.9.3/",
  archive: "gamekit",
} as const;

const FAVICON_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAADOklEQVRYhb1X/0tTURR/P9Xf8La35/cvLL8SJRIIKbTIfrComYklppa2hSZ9pczyG6mRYpGamWlOjfJbKNNI/EI2RzXRUozUNDXTVGz+fuJcdb25t+2Ntl34wGPn3Pv53LNzzr2XojaHp6fnTjFLX2BYWsOwonWGFYGdsb6xNq1ELoo7GIYRMxJ6yAGk/JDQOuQ07Nyp5BwRJBIbYXcyuQG0AgUMCnH2D5RC7MnjkJ+XBbU1j6GtpRF6uzsI8LvmWQXk5d6C6BNHwVfqLTQK7ymGFenNOQQG+8O1qxfhXW8X6FfnBWNteRbU7U2QmHgK3DxYSyL0FJ8hIGgX3L+XD78XvttEzIfRYS3I5VFmRVDbf0hOjofFn5P/TczFn5U5KCzIti7g0OEDJHz2JOciPf28ZQHq9iaHkSOmvg2Di5uEX4CPrxesLs04VAACo8wrYH94mMPJEakpifwCZAcjnCIgLS2VX0BgkJ9TBMijj5hPwhGdxqHky7+mQernY15A9p0bFhfAFnw76zpMT3wxsc1MjhJbbXW52fkvX9RaLkMvb3cYG9HyTu7v7TT4pZw7Y2JXKM8a7D1v203sSwtTELpvr/VOKJOFw4+pMaPJ2Jy0mh6QuIiJT0aGwoTg8qU0YkOfgf43RjYs76Sk08JaMbNZkrgLVN3W3ACfhwbJQp0dzVBeVgyL8xPwUdsHuTmZUFpSCCuLM6R9V5SVkGaGZ0hV5UPip/vQDzExx4SfBcw2hITuMdnt69ZGcHX/d8olJMSZ+MTHxwo6kilrDnikWislxPjYJyOfooIc+whQKpJNBJQU3zXkA4lSyG4Sbq7Pg9Ii+wiQy6N4qwKTEvOhXlUFc9PjJvbMm1fsI8DLxwMWZr8aLd6gekpCrKp7QoDfjfXVRj7hEWH2EcCwInIP3F6WSIrtG1FUmGN0j2h5pRJELlgAZnyXulXwFQwvsLYI0Atx9PB0hbrnlRbJ+3rUEBQcIJhcLBGtCb6WbyEyUgZlj4pJa8a2rRnoJmdEXFw0sK6M4HU413JaadMku4JWbD3NdE4nl9A6qVS6g/s4dZ4I7uN0a6AaDAn+L0IT00boGQk9gByGnVMU9Rf1xuifXupRpwAAAABJRU5ErkJggg==";

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
    icon: options.preview ? `data:image/png;base64,${FAVICON_BASE64}` : "favicon.png",
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
