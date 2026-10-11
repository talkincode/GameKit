import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { diagnoseProject } from "../diagnostics";
import { sourceZip } from "../export";
import { upsertFile, type Project, type ProjectFile } from "../project";
import {
  PINS_PATH,
  applyLibraryCopy,
  describeLibraryCopy,
  fileBytes,
  libraryCopyFrom,
  libraryDest,
  readPins,
} from "./copy";
import { buildForestPack } from "./forest";
import { sha256Hex } from "./hash";

function project(files: ProjectFile[] = []): Project {
  return { id: "p", name: "game", createdAt: 0, updatedAt: 0, files };
}

async function heroCopy() {
  const built = await buildForestPack();
  const asset = built.manifest.assets.find((item) => item.id === "hero");
  if (!asset) throw new Error("missing hero");
  return { built, asset, copy: libraryCopyFrom(built.manifest, asset, built.files[asset.path]) };
}

describe("copying a library asset into a project", () => {
  it("copies bytes, pins the version, and does nothing on a second add", async () => {
    const { copy } = await heroCopy();
    const added = await applyLibraryCopy(project(), copy, "add", "none");
    expect(added.changed).toBe(true);
    expect(added.code).toBe("added");
    expect(fileBytes(added.project, added.path)).toEqual(copy.bytes);
    const pins = readPins(added.project);
    expect(pins?.copies).toEqual([
      expect.objectContaining({
        packId: "forest-adventure",
        assetId: "hero",
        assetVersion: "1.0.0",
        sha256: copy.sha256,
        license: "CC0-1.0",
        author: "GameKit",
        source: "https://github.com/talkincode/GameKit",
        path: libraryDest(copy),
      }),
    ]);
    expect(pins?.copies[0].attribution.length).toBeGreaterThan(0);

    const again = await applyLibraryCopy(added.project, copy, "add", "none");
    expect(again.changed).toBe(false);
    expect(again.code).toBe("identical");
    expect(again.project.files.filter((file) => file.path === added.path)).toHaveLength(1);
  });

  it("keeps, replaces, or saves aside a different file, and refuses to guess", async () => {
    const { copy } = await heroCopy();
    const old = new Uint8Array(copy.bytes);
    old[20] ^= 0xff;
    const path = libraryDest(copy);
    const clash = project([{ path, bytes: old }]);

    expect(await describeLibraryCopy(clash, copy)).toMatchObject({ kind: "conflict", reason: "name", path });
    const refused = await applyLibraryCopy(clash, copy, "add", "none");
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe("needs-choice");
    expect(fileBytes(refused.project, path)).toEqual(old);

    const kept = await applyLibraryCopy(clash, copy, "keep", "none");
    expect(kept.changed).toBe(false);
    expect(fileBytes(kept.project, path)).toEqual(old);

    const replaced = await applyLibraryCopy(clash, copy, "replace", "none");
    expect(replaced.code).toBe("replaced");
    expect(fileBytes(replaced.project, path)).toEqual(copy.bytes);
    expect(fileBytes(clash, path)).toEqual(old);

    const aside = await applyLibraryCopy(clash, copy, "save-as", "none");
    expect(aside.path).toBe(path.replace(/\.png$/, "-2.png"));
    expect(fileBytes(aside.project, path)).toEqual(old);
    expect(fileBytes(aside.project, aside.path)).toEqual(copy.bytes);
  });

  it("treats a newer pinned version as an update, and a hand-edited file as a conflict", async () => {
    const { copy } = await heroCopy();
    const added = await applyLibraryCopy(project(), copy, "add", "none");
    const newerBytes = new Uint8Array(copy.bytes);
    newerBytes[24] ^= 0xff;
    const newer = { ...copy, assetVersion: "1.1.0", bytes: newerBytes, sha256: await sha256Hex(newerBytes) };
    expect(await describeLibraryCopy(added.project, newer)).toMatchObject({
      kind: "update",
      fromVersion: "1.0.0",
      toVersion: "1.1.0",
    });
    const updated = await applyLibraryCopy(added.project, newer, "replace", "none");
    expect(updated.code).toBe("updated");
    expect(readPins(updated.project)?.copies[0].assetVersion).toBe("1.1.0");
    expect(fileBytes(added.project, added.path)).toEqual(copy.bytes);

    const hand = new Uint8Array(copy.bytes);
    hand[30] ^= 0xff;
    const edited = upsertFile(added.project, { path: added.path, bytes: hand });
    expect(await describeLibraryCopy(edited, newer)).toMatchObject({ kind: "conflict", reason: "edited" });
    const kept = await applyLibraryCopy(edited, newer, "keep", "none");
    expect(fileBytes(kept.project, added.path)).toEqual(hand);
  });

  it("writes a runnable pygame example only when asked, and never fetches the library", async () => {
    const { copy } = await heroCopy();
    const quiet = await applyLibraryCopy(project([{ path: "main.py", text: "print('mine')\n" }]), copy, "add", "none");
    expect(quiet.project.files.find((file) => file.path === "main.py")?.text).toBe("print('mine')\n");

    const demo = await applyLibraryCopy(project(), copy, "add", "main");
    const main = demo.project.files.find((file) => file.path === "main.py")?.text ?? "";
    expect(main).toContain(`pygame.image.load("${demo.path}")`);
    expect(main).toContain("await asyncio.sleep(0)");
    expect(main).toContain("LIBRARY-OK");
    expect(main).not.toContain("/asset-packs/");
    expect(diagnoseProject(demo.project).filter((problem) => problem.severity === "error")).toEqual([]);

    const packed = unzipSync(sourceZip(demo.project));
    expect(Buffer.from(packed[demo.path]).equals(Buffer.from(copy.bytes))).toBe(true);
    expect(packed[demo.path][0]).toBe(137);

    const example = await applyLibraryCopy(demo.project, copy, "add", "file");
    expect(example.code).toBe("example-file");
    expect(example.examplePath).toBe("examples/load-hero.py");
    const again = await applyLibraryCopy(example.project, copy, "add", "file");
    expect(again.changed).toBe(false);
    expect(again.code).toBe("example-kept");
  });

  it("does not overwrite a library.json the child already changed, and rejects a bad hash", async () => {
    const { copy } = await heroCopy();
    const custom = project([{ path: PINS_PATH, text: "{\"hello\":true}\n" }]);
    const added = await applyLibraryCopy(custom, copy, "add", "none");
    expect(added.pinsSkipped).toBe(true);
    expect(added.project.files.find((file) => file.path === PINS_PATH)?.text).toContain("hello");
    expect(fileBytes(added.project, added.path)).toEqual(copy.bytes);

    const bad = await applyLibraryCopy(project(), { ...copy, bytes: new Uint8Array([1, 2, 3]) }, "add", "none");
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe("hash-mismatch");
    expect(bad.changed).toBe(false);
    expect(bad.project.files).toEqual([]);
  });
});
