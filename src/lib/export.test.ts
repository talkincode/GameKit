import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildWebBundle } from "./build";
import { embedZip, projectFromArchive, sourceZip, staticFolderZip, webZip } from "./export";
import type { Project } from "./project";

const template = readFileSync(new URL("../../runtime/player.tmpl", import.meta.url), "utf8");
const source = "import asyncio\nimport pygame\nscreen = pygame.display.set_mode((640, 360))\nawait asyncio.sleep(0)\n";

function project(): Project {
  return {
    id: "p",
    name: "Signal Drift",
    createdAt: 0,
    updatedAt: 0,
    files: [
      { path: "main.py", text: source },
      { path: "game/player.py", text: "class Player:\n    pass\n" },
      { path: "assets/player.png", bytes: Uint8Array.from([1, 2, 3, 4]) },
    ],
  };
}

describe("web bundle", () => {
  it("packs the original source and points the player at the zip runtime", () => {
    const preview = buildWebBundle(project(), { template, preview: true });
    const exported = buildWebBundle(project(), { template, preview: false });
    const packed = unzipSync(preview.apk);
    expect(strFromU8(packed["assets/main.py"])).toBe(source);
    expect(strFromU8(packed["assets/game/player.py"])).toContain("class Player");
    expect(packed["assets/assets/player.png"]).toEqual(Uint8Array.from([1, 2, 3, 4]));
    expect(preview.html).toContain("gamekit.apk");
    expect(preview.html).not.toContain(".tar.gz");
    expect(preview.html).toContain('gamekit_debug : 1');
    expect(exported.html).toContain('gamekit_debug : 0');
    expect(preview.html).toContain("640");
    expect(preview.html).not.toContain("{{cookiecutter.");
  });

  it("exports packages that do not depend on a GameKit URL", () => {
    const bundle = buildWebBundle(project(), { template, preview: false });
    const web = unzipSync(webZip(bundle));
    const folder = unzipSync(staticFolderZip(bundle, "Signal Drift"));
    const embed = unzipSync(embedZip(bundle));
    expect(Object.keys(web).sort()).toEqual(["favicon.png", "gamekit.apk", "index.html"]);
    expect(Object.keys(folder).every((name) => name.startsWith("signal-drift/"))).toBe(true);
    expect(embed["embed.html"]).toBeTruthy();
    const html = strFromU8(web["index.html"]);
    expect(html).not.toContain("gamekit.talkincode.net");
    expect(html).toContain("https://pygame-web.github.io/cdn/0.9.3/");
  });

  it("round-trips a source archive and strips one wrapper folder", () => {
    const archive = sourceZip(project());
    const restored = projectFromArchive("demo.zip", archive);
    expect(restored.files.find((file) => file.path === "main.py")?.text).toBe(source);
    const wrapped = projectFromArchive("wrapped.zip", sourceZip({ ...project(), files: project().files.map((file) => ({ ...file, path: `wrapped/${file.path}` })) }));
    expect(wrapped.files.some((file) => file.path === "main.py")).toBe(true);
  });
});
