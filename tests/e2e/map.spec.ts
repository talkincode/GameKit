import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { text } from "../../src/ui/text";

// 瓦片地图：不登录。画关、碰撞、出生点和物件保存后能重新打开；
// 地图包导入后和原来一致；源码包里是 JSON + CSV + PNG；舞台上的 pygame 打出同一组碰撞和出生点。
// 坏的地图说明和失败的写入都不改作品。

const DOC = "maps/level-1.map.json";
const GROUND = "maps/level-1.ground.csv";
const DECOR = "maps/level-1.decor.csv";
const COLLISION = "maps/level-1.collision.csv";
const TILESET = "maps/level-1.tileset.png";
const GRASS = [56, 183, 100, 255];
const NIGHT = [27, 30, 43, 255];

async function openFiles(page: Page) {
  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.code.files, exact: true }).click();
}

async function startMap(page: Page, slug = "level-1") {
  await openFiles(page);
  await page.getByTestId("map-new").click();
  const dialog = page.getByTestId("map-new-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("map-slug").fill(slug);
  await dialog.getByTestId("map-size-small").click();
  await dialog.getByTestId("map-tile-size-16").click();
  await dialog.getByTestId("map-start").click();
  const editor = page.getByTestId("map-editor");
  await expect(editor).toBeVisible();
  return editor;
}

function canvas(page: Page) {
  return page.getByTestId("map-canvas");
}

async function cellPoint(page: Page, x: number, y: number) {
  const node = canvas(page);
  await node.scrollIntoViewIfNeeded();
  const box = await node.boundingBox();
  const columns = Number(await node.getAttribute("data-columns"));
  const rows = Number(await node.getAttribute("data-rows"));
  if (!box || !columns || !rows) throw new Error("map canvas is not on screen");
  return { x: box.x + ((x + 0.5) * box.width) / columns, y: box.y + ((y + 0.5) * box.height) / rows };
}

async function clickCell(page: Page, x: number, y: number) {
  const point = await cellPoint(page, x, y);
  await page.mouse.click(point.x, point.y);
}

async function dragCells(page: Page, from: [number, number], to: [number, number]) {
  const start = await cellPoint(page, from[0], from[1]);
  const end = await cellPoint(page, to[0], to[1]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
}

async function pixelAt(target: Locator, x: number, y: number): Promise<number[]> {
  return target.evaluate(
    (node: HTMLCanvasElement, [px, py]) => Array.from((node.getContext("2d") as CanvasRenderingContext2D).getImageData(px, py, 1, 1).data),
    [x, y] as [number, number],
  );
}

type FileRow = { path: string; base64?: string; text?: string };

async function filesOf(page: Page): Promise<FileRow[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gamekit");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<{ files: FileRow[] }[]>((resolve, reject) => {
      const request = db.transaction("projects").objectStore("projects").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows.flatMap((row) => row.files);
  });
}

async function fileOf(page: Page, path: string): Promise<FileRow | null> {
  const files = await filesOf(page);
  return files.find((item) => item.path === path) ?? null;
}

test("anonymous: a painted map is saved, reopened, exported, and played by pygame", async ({ page }) => {
  test.setTimeout(180_000);
  const api: string[] = [];
  await page.goto("/");
  await expect(page.getByRole("button", { name: text.stage.play })).toBeVisible();
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) api.push(request.url());
  });

  await startMap(page);
  await expect(canvas(page)).toHaveAttribute("data-columns", "10");
  await expect(canvas(page)).toHaveAttribute("data-rows", "8");
  await expect(canvas(page)).toHaveAttribute("data-tile-width", "16");
  await expect(page.getByTestId("map-readout")).toHaveAttribute("data-spawn", "1,6");

  await page.getByTestId("map-tile-1").click();
  await page.getByTestId("map-tool-pencil").click();
  await clickCell(page, 2, 3);
  await page.getByTestId("map-tool-rect").click();
  await dragCells(page, [4, 3], [5, 4]);
  await page.getByTestId("map-tool-erase").click();
  await clickCell(page, 4, 3);
  await page.getByTestId("map-tile-2").click();
  await page.getByTestId("map-tool-pencil").click();
  await clickCell(page, 8, 1);
  await page.getByTestId("map-tile-3").click();
  await page.getByTestId("map-tool-fill").click();
  await clickCell(page, 8, 1);

  await page.getByTestId("map-mode-collision").click();
  await page.getByTestId("map-tool-pencil").click();
  await clickCell(page, 2, 3);
  await clickCell(page, 3, 3);
  await page.getByTestId("map-tool-spawn").click();
  await clickCell(page, 2, 7);
  await page.getByTestId("map-kind-coin").click();
  await clickCell(page, 4, 5);

  await page.getByTestId("map-layer-add").click();
  await expect(page.getByTestId("map-layer-1")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("map-tile-4").click();
  await clickCell(page, 0, 0);
  await page.getByTestId("map-layer-visible-1").click();
  await expect(page.getByTestId("map-layer-visible-1")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("map-bg-night").click();
  await page.getByTestId("map-show-collision").uncheck();

  const tile = 16;
  expect(await pixelAt(canvas(page), 2 * tile + 8, 3 * tile + 8)).toEqual(GRASS);
  expect(await pixelAt(canvas(page), 8, 8)).toEqual(NIGHT);

  const readout = page.getByTestId("map-readout");
  await expect(readout).toHaveAttribute("data-solids", "2");
  await expect(readout).toHaveAttribute("data-objects", "1");
  await expect(readout).toHaveAttribute("data-spawn", "2,7");
  const fingerprint = await readout.getAttribute("data-fingerprint");
  expect(fingerprint).toBeTruthy();

  await expect(page.getByTestId("map-snippet")).toContainText(DOC);
  await expect(page.getByTestId("map-snippet")).not.toContainText("import gamekit");

  const [bundle] = await Promise.all([page.waitForEvent("download"), page.getByTestId("map-export").click()]);
  const bundlePath = await bundle.path();
  expect(bundle.suggestedFilename()).toBe("level-1.map-bundle.json");

  await page.getByTestId("map-save").click();
  await expect(page.getByTestId("map-saved")).toContainText(DOC);
  await expect(page.getByTestId("map-editor")).toHaveAttribute("data-dirty", "false");
  await page.getByTestId("map-close").click();
  await expect(page.getByTestId("map-editor")).toHaveCount(0);

  const ground = (await fileOf(page, GROUND))?.text ?? "";
  expect(ground.split("\n")[1]).toBe("0,0,0,0,0,0,0,0,3,0");
  expect(ground.split("\n")[3]).toBe("0,0,1,0,0,1,0,0,0,0");
  expect(ground.split("\n")[4]).toBe("0,0,0,0,1,1,0,0,0,0");
  expect((await fileOf(page, DECOR))?.text?.split("\n")[0]).toBe("4,0,0,0,0,0,0,0,0,0");
  expect((await fileOf(page, COLLISION))?.text?.split("\n")[3]).toBe("0,0,1,1,0,0,0,0,0,0");
  const saved = JSON.parse((await fileOf(page, DOC))?.text ?? "");
  expect(saved.format).toBe("gamekit.map");
  expect(saved.background).toBe("#1b1e2b");
  expect(saved.spawn).toEqual({ tileX: 2, tileY: 7 });
  expect(saved.layers[1].visible).toBe(false);
  expect(saved.objects).toEqual([{ id: "coin-1", name: "金币", kind: "coin", tileX: 4, tileY: 5 }]);
  expect(await fileOf(page, TILESET)).not.toBeNull();

  await openFiles(page);
  await page.getByRole("button", { name: text.map.editFile(DOC), exact: true }).click();
  await expect(page.getByTestId("map-editor")).toBeVisible();
  await expect(page.getByTestId("map-readout")).toHaveAttribute("data-fingerprint", fingerprint ?? "");
  await expect(page.getByTestId("map-readout")).toHaveAttribute("data-solids", "2");
  await expect(page.getByTestId("map-readout")).toHaveAttribute("data-spawn", "2,7");
  await expect(page.getByTestId("map-readout")).toHaveAttribute("data-objects", "1");

  await page.getByTestId("map-try-play").click();
  await expect(page.getByTestId("map-try-dialog")).toContainText("main.py");
  await page.getByTestId("map-try-confirm").click();
  await expect(page.getByTestId("map-example-note")).toBeVisible();
  await page.getByTestId("map-close").click();
  await expect(page.getByTestId("map-editor")).toHaveCount(0);

  await page.getByRole("button", { name: text.stage.play }).click();
  await expect(page.locator(".console")).toContainText("async: ok", { timeout: 120_000 });
  await page.frameLocator(`iframe[title="${text.brand.name}"]`).locator("#canvas").click({ position: { x: 10, y: 10 }, force: true });
  await expect(page.locator(".console")).toContainText("MAP-OK 32 112 2", { timeout: 120_000 });
  await expect(page.locator(".console")).toContainText("MAP-TILE 56 183 100 255");
  await expect(page.locator(".console")).toContainText("MAP-OBJECTS 1");

  await page.getByRole("button", { name: text.header.project, exact: true }).click();
  const [source] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("projects-panel").getByRole("button", { name: text.project.exportSource, exact: true }).first().click(),
  ]);
  const packed = unzipSync(new Uint8Array(readFileSync(await source.path())));
  expect(new TextDecoder().decode(packed[GROUND])).toBe(ground);
  expect(new TextDecoder().decode(packed[COLLISION]).split("\n")[3]).toBe("0,0,1,1,0,0,0,0,0,0");
  expect(packed[TILESET]?.byteLength).toBeGreaterThan(8);
  const main = new TextDecoder().decode(packed["main.py"]);
  expect(main).toContain("MAP-OK");
  expect(main).toContain("asyncio.sleep(0)");
  expect(main).not.toContain("import gamekit");
  const loader = new TextDecoder().decode(packed["map_loader.py"]);
  expect(loader).toContain("def load_map");
  expect(loader).toContain("def solid_at");
  expect(loader).not.toContain("import gamekit");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: text.header.undoShort, exact: true }).click();
  await expect.poll(async () => (await fileOf(page, "main.py"))?.text ?? "").not.toContain("MAP-OK");
  await expect.poll(async () => fileOf(page, "map_loader.py")).toBeNull();
  expect((await fileOf(page, DOC))?.text).toContain('"tileX": 2');
  expect(await fileOf(page, GROUND)).not.toBeNull();

  await startMap(page, "level-2");
  await page.getByTestId("map-import-file").setInputFiles(bundlePath);
  await expect(page.getByTestId("map-readout")).toHaveAttribute("data-fingerprint", fingerprint ?? "");
  await expect(page.getByTestId("map-editor")).toHaveAttribute("data-dirty", "true");
  await page.getByTestId("map-save").click();
  await expect(page.getByTestId("map-saved")).toContainText("maps/level-2.map.json");
  await expect.poll(async () => (await fileOf(page, "maps/level-2.ground.csv"))?.text ?? "").toBe(ground);
  expect((await fileOf(page, "maps/level-2.collision.csv"))?.text).toBe((await fileOf(page, COLLISION))?.text);
  const imported = JSON.parse((await fileOf(page, "maps/level-2.map.json"))?.text ?? "");
  expect(imported.spawn).toEqual({ tileX: 2, tileY: 7 });
  expect(imported.tileset.image).toBe("maps/level-2.tileset.png");
  expect(api).toEqual([]);
});

test("a bad map file and a failed write leave the project untouched", async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if ((window as unknown as { gkFailPut?: boolean }).gkFailPut) throw new DOMException("disk full", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: text.stage.play })).toBeVisible();
  const before = (await fileOf(page, "assets/player.png"))?.base64;
  expect(before).toBeTruthy();

  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gamekit");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction("projects", "readwrite");
    const store = tx.objectStore("projects");
    const rows = await new Promise<{ files: { path: string; text?: string }[] }[]>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const row = rows.find((item) => item.files.some((file) => file.path === "assets/player.png"));
    if (!row) throw new Error("starter project missing");
    row.files.push({ path: "maps/broken.map.json", text: "{" });
    await new Promise<void>((resolve, reject) => {
      const request = store.put(row);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByRole("button", { name: text.stage.play })).toBeVisible();

  await openFiles(page);
  await page.getByRole("button", { name: text.map.editFile("maps/broken.map.json"), exact: true }).click();
  await expect(page.getByTestId("map-open-error")).toBeVisible();
  await expect(page.getByTestId("map-open-error")).toContainText(text.map.read["not-json"]);
  await page.getByTestId("map-open-error").getByRole("button", { name: text.map.close }).click();
  await expect(page.getByTestId("map-open-error")).toHaveCount(0);
  expect((await fileOf(page, "maps/broken.map.json"))?.text).toBe("{");
  expect((await fileOf(page, "assets/player.png"))?.base64).toBe(before);

  await startMap(page, "level-flaky");
  await page.getByTestId("map-import-file").setInputFiles({
    name: "bad.map-bundle.json",
    mimeType: "application/json",
    buffer: Buffer.from("{"),
  });
  await expect(page.getByTestId("map-problem")).toHaveText(text.map.read["not-json"]);
  await expect(page.getByTestId("map-editor")).toHaveAttribute("data-dirty", "false");
  await expect(page.getByTestId("map-readout")).toHaveAttribute("data-spawn", "1,6");

  await page.getByTestId("map-tile-1").click();
  await clickCell(page, 2, 3);
  await expect(page.getByTestId("map-editor")).toHaveAttribute("data-dirty", "true");

  await page.evaluate(() => {
    (window as unknown as { gkFailPut: boolean }).gkFailPut = true;
  });
  await page.getByTestId("map-save").click();
  await expect(page.getByTestId("map-problem")).toHaveText(text.map.failed["write-failed"]);
  await expect(page.getByTestId("map-editor")).toHaveAttribute("data-dirty", "true");
  expect(await fileOf(page, "maps/level-flaky.map.json")).toBeNull();
  expect(await fileOf(page, "maps/level-flaky.ground.csv")).toBeNull();
  expect((await fileOf(page, "assets/player.png"))?.base64).toBe(before);
  expect((await fileOf(page, "maps/broken.map.json"))?.text).toBe("{");
  await expect(page.getByTitle(text.header.undo)).toBeDisabled();

  await page.evaluate(() => {
    (window as unknown as { gkFailPut: boolean }).gkFailPut = false;
  });
  await page.getByTestId("map-save").click();
  await expect(page.getByTestId("map-saved")).toContainText("maps/level-flaky.map.json");
  await expect(page.getByTestId("map-problem")).toHaveCount(0);
  expect((await fileOf(page, "maps/level-flaky.ground.csv"))?.text).toContain("1");
  await expect(page.getByTitle(text.header.undo)).toBeEnabled();
});
