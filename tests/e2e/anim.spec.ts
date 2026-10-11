import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { createPixels, type Pixels } from "../../src/lib/pixel/buffer";
import { encodePng } from "../../src/lib/pixel/png";
import { text } from "../../src/ui/text";

// 精灵与动画：不登录。多帧画完保存，重新打开后帧序、时长和透明通道还在；
// 源码包里是 PNG + JSON；舞台上的 pygame 打出同一组时长和像素。
// 坏的说明和失败的写入都不改作品。

const ORANGE = "#ef7d57";
const GREEN = "#38b764";
const HERO = "assets/hero.png";
const NOTE = "assets/hero.anim.json";

async function openAssets(page: Page) {
  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.code.assets, exact: true }).click();
}

async function startNew(page: Page, name: string) {
  await openAssets(page);
  await page.getByTestId("pixel-new").click();
  const dialog = page.getByTestId("pixel-new-dialog");
  await dialog.getByTestId("pixel-name").fill(name);
  await dialog.getByRole("button", { name: text.pixel.sizeValue(16) }).click();
  await dialog.getByTestId("pixel-start").click();
  const editor = page.getByTestId("pixel-editor");
  await expect(editor).toBeVisible();
  return editor;
}

async function edit(page: Page, path: string) {
  await openAssets(page);
  await page.getByRole("button", { name: text.pixel.editFile(path), exact: true }).click();
  const editor = page.getByTestId("pixel-editor");
  await expect(editor).toBeVisible();
  await expect(page.getByTestId("pixel-canvas")).toBeVisible();
  return editor;
}

function canvas(page: Page) {
  return page.getByTestId("pixel-canvas");
}

async function cellPoint(page: Page, x: number, y: number) {
  const box = await canvas(page).boundingBox();
  const scale = Number(await canvas(page).getAttribute("data-scale"));
  if (!box) throw new Error("canvas is not on screen");
  return { x: box.x + (x + 0.5) * scale, y: box.y + (y + 0.5) * scale };
}

async function click(page: Page, x: number, y: number) {
  const point = await cellPoint(page, x, y);
  await page.mouse.click(point.x, point.y);
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
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

const hex = (value: string) => [1, 3, 5].map((at) => Number.parseInt(value.slice(at, at + 2), 16)).concat(255);

async function pickColor(page: Page, name: string) {
  await page.getByTestId("pixel-editor").getByRole("button", { name, exact: true }).click();
}

async function setDuration(page: Page, ms: number) {
  const input = page.getByTestId("pixel-frame-duration");
  await input.fill(String(ms));
  await input.press("Enter");
  await expect(input).toHaveValue(String(ms));
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

type Stored = { base64: string; width: number; height: number; data: number[] };

async function storedPng(page: Page, path: string): Promise<Stored | null> {
  const file = await fileOf(page, path);
  if (!file?.base64) return null;
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const surface = document.createElement("canvas");
    surface.width = bitmap.width;
    surface.height = bitmap.height;
    const context = surface.getContext("2d") as CanvasRenderingContext2D;
    context.drawImage(bitmap, 0, 0);
    return {
      base64,
      width: bitmap.width,
      height: bitmap.height,
      data: Array.from(context.getImageData(0, 0, bitmap.width, bitmap.height).data),
    };
  }, file.base64);
}

function at(image: Stored, x: number, y: number): number[] {
  const index = (y * image.width + x) * 4;
  return image.data.slice(index, index + 4);
}

function paint(pixels: Pixels, x: number, y: number, color: string) {
  const [r, g, b, a] = hex(color);
  const index = (y * pixels.width + x) * 4;
  pixels.data[index] = r;
  pixels.data[index + 1] = g;
  pixels.data[index + 2] = b;
  pixels.data[index + 3] = a;
}

test("anonymous: frames are saved, reopened, exported, and played by pygame", async ({ page }) => {
  test.setTimeout(180_000);
  const api: string[] = [];
  await page.goto("/");
  await expect(page.getByRole("button", { name: text.stage.play })).toBeVisible();
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) api.push(request.url());
  });

  await startNew(page, HERO);
  await expect(canvas(page)).toHaveAttribute("data-width", "16");
  await pickColor(page, text.pixel.colors[ORANGE]);
  await click(page, 1, 1);
  await page.getByTestId("pixel-fps-4").click();
  await expect(page.getByTestId("pixel-frame-duration")).toHaveValue("250");
  await setDuration(page, 200);
  await page.getByTestId("pixel-state-idle").click();
  await expect(page.getByTestId("pixel-state-idle")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("pixel-add-frame").click();
  await expect(page.getByTestId("pixel-frame-1")).toHaveAttribute("aria-pressed", "true");
  await pickColor(page, text.pixel.colors[GREEN]);
  await click(page, 2, 2);
  await setDuration(page, 80);
  await page.getByTestId("pixel-state-walk").click();
  await expect(page.getByTestId("pixel-state-walk")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("pixel-play").click();
  await expect(page.getByTestId("pixel-play")).toHaveAttribute("aria-pressed", "true");
  await expect(canvas(page)).toHaveAttribute("data-frame", "0");
  await page.getByTestId("pixel-play").click();
  await expect(page.getByTestId("pixel-play")).toHaveAttribute("aria-pressed", "false");

  const snippet = page.getByTestId("pixel-anim-snippet");
  await expect(snippet).toContainText("durationMs");
  await expect(snippet).toContainText(NOTE);
  await expect(snippet).not.toContainText("import gamekit");

  await page.getByTestId("pixel-save").click();
  await expect(page.getByTestId("pixel-try-play")).toBeVisible();
  await page.getByTestId("pixel-close").click();
  await expect(page.getByTestId("pixel-editor")).toHaveCount(0);

  const png = await storedPng(page, HERO);
  expect(png).not.toBeNull();
  expect([png?.width, png?.height]).toEqual([32, 16]);
  expect(at(png as Stored, 0, 0)[3]).toBe(0);
  expect(at(png as Stored, 1, 1)).toEqual(hex(ORANGE));
  expect(at(png as Stored, 18, 2)).toEqual(hex(GREEN));

  const note = JSON.parse((await fileOf(page, NOTE))?.text ?? "");
  expect(note.format).toBe("gamekit.sprite-anim");
  expect(note.image).toBe(HERO);
  expect(note.animation.frameWidth).toBe(16);
  expect(note.animation.frameHeight).toBe(16);
  expect(note.animation.frames).toEqual([
    { index: 0, durationMs: 200 },
    { index: 1, durationMs: 80 },
  ]);
  expect(note.animation.states).toEqual({ idle: [0], walk: [1] });

  await edit(page, HERO);
  await expect(canvas(page)).toHaveAttribute("data-width", "16");
  await expect(canvas(page)).toHaveAttribute("data-height", "16");
  await expect(page.getByTestId("pixel-frame-duration")).toHaveValue("200");
  expect(await pixelAt(canvas(page), 1, 1)).toEqual(hex(ORANGE));
  await page.getByTestId("pixel-frame-1").click();
  await expect(canvas(page)).toHaveAttribute("data-frame", "1");
  await expect(page.getByTestId("pixel-frame-duration")).toHaveValue("80");
  expect(await pixelAt(canvas(page), 2, 2)).toEqual(hex(GREEN));
  expect((await pixelAt(canvas(page), 1, 1))[3]).toBe(0);
  await expect(page.getByTestId("pixel-state-walk")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("pixel-try-play").click();
  await expect(page.getByTestId("pixel-try-dialog")).toContainText("main.py");
  await page.getByTestId("pixel-try-confirm").click();
  await expect(page.getByTestId("pixel-example-note")).toBeVisible();
  await page.getByTestId("pixel-close").click();
  await expect(page.getByTestId("pixel-editor")).toHaveCount(0);

  await page.getByRole("button", { name: text.stage.play }).click();
  await expect(page.locator(".console")).toContainText("async: ok", { timeout: 120_000 });
  await page.frameLocator(`iframe[title="${text.brand.name}"]`).locator("#canvas").click({ position: { x: 10, y: 10 }, force: true });
  await expect(page.locator(".console")).toContainText("ANIM-OK 2 200,80", { timeout: 120_000 });
  await expect(page.locator(".console")).toContainText("ANIM-PIXEL 239 125 87 255");

  await page.getByRole("button", { name: text.header.project, exact: true }).click();
  const [source] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("projects-panel").getByRole("button", { name: text.project.exportSource, exact: true }).first().click(),
  ]);
  const packed = unzipSync(new Uint8Array(readFileSync(await source.path())));
  expect(Buffer.from(packed[HERO]).toString("base64")).toBe(png?.base64);
  const exported = JSON.parse(new TextDecoder().decode(packed[NOTE]));
  expect(exported.animation.frames).toEqual(note.animation.frames);
  expect(exported.animation.states).toEqual(note.animation.states);
  const main = new TextDecoder().decode(packed["main.py"]);
  expect(main).toContain("ANIM-OK");
  expect(main).toContain("asyncio.sleep(0)");
  expect(main).toContain("convert_alpha");
  expect(main).not.toContain("import gamekit");
  const moduleText = new TextDecoder().decode(packed["sprite_anim.py"]);
  expect(moduleText).toContain("duration_ms");
  expect(moduleText).not.toContain("import gamekit");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: text.header.undoShort, exact: true }).click();
  await expect.poll(async () => (await fileOf(page, "main.py"))?.text ?? "").not.toContain("ANIM-OK");
  await expect.poll(async () => fileOf(page, "sprite_anim.py")).toBeNull();
  expect((await fileOf(page, NOTE))?.text).toContain('"durationMs": 200');
  expect(await fileOf(page, HERO)).not.toBeNull();
  expect(api).toEqual([]);
});

test("a bad animation note and a failed write leave the picture untouched", async ({ page }) => {
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
    row.files.push({ path: "assets/player.anim.json", text: "{" });
    await new Promise<void>((resolve, reject) => {
      const request = store.put(row);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByRole("button", { name: text.stage.play })).toBeVisible();

  await edit(page, "assets/player.png");
  await expect(page.getByTestId("pixel-anim-problem")).toHaveText(text.pixel.anim.unread);
  await expect(canvas(page)).toHaveAttribute("data-width", "32");
  await expect(canvas(page)).toHaveAttribute("data-height", "32");
  await expect(page.getByTestId("pixel-frame-1")).toHaveCount(0);
  await page.getByTestId("pixel-close").click();
  await expect(page.getByTestId("pixel-editor")).toHaveCount(0);
  expect((await fileOf(page, "assets/player.png"))?.base64).toBe(before);
  expect((await fileOf(page, "assets/player.anim.json"))?.text).toBe("{");

  await startNew(page, "assets/flaky-anim.png");
  await pickColor(page, text.pixel.colors[ORANGE]);
  await click(page, 1, 1);
  await page.getByTestId("pixel-add-frame").click();
  await pickColor(page, text.pixel.colors[GREEN]);
  await click(page, 2, 2);

  await page.evaluate(() => {
    (window as unknown as { gkFailPut: boolean }).gkFailPut = true;
  });
  await page.getByTestId("pixel-save").click();
  await expect(page.getByTestId("pixel-problem")).toHaveText(text.pixel.failed["write-failed"]);
  await expect(page.getByTestId("pixel-editor")).toHaveAttribute("data-dirty", "true");
  expect(await pixelAt(canvas(page), 2, 2)).toEqual(hex(GREEN));
  expect(await fileOf(page, "assets/flaky-anim.png")).toBeNull();
  expect(await fileOf(page, "assets/flaky-anim.anim.json")).toBeNull();
  expect((await fileOf(page, "assets/player.png"))?.base64).toBe(before);
  await expect(page.getByTitle(text.header.undo)).toBeDisabled();

  await page.evaluate(() => {
    (window as unknown as { gkFailPut: boolean }).gkFailPut = false;
  });
  await page.getByTestId("pixel-save").click();
  await expect(page.getByTestId("pixel-try-play")).toBeVisible();
  await expect(page.getByTestId("pixel-problem")).toHaveCount(0);
  expect(await fileOf(page, "assets/flaky-anim.png")).not.toBeNull();
  expect((await fileOf(page, "assets/flaky-anim.anim.json"))?.text).toContain('"index": 1');
  await expect(page.getByTitle(text.header.undo)).toBeEnabled();
});

test("selection, layers, onion skin, and a sprite sheet can be undone", async ({ page }) => {
  await page.goto("/");
  await startNew(page, "assets/bits.png");
  await pickColor(page, text.pixel.colors[ORANGE]);
  await click(page, 1, 1);

  await page.getByTestId("pixel-copy-frame").click();
  await expect(page.getByTestId("pixel-frame-1")).toHaveAttribute("aria-pressed", "true");
  expect(await pixelAt(canvas(page), 1, 1)).toEqual(hex(ORANGE));
  await page.getByTestId("pixel-delete-frame").click();
  await expect(page.getByTestId("pixel-frame-1")).toHaveCount(0);
  await page.getByTestId("pixel-delete-frame").click();
  await expect(page.getByTestId("pixel-anim-limit")).toHaveText(text.pixel.anim.limitLastFrame);

  await page.getByTestId("pixel-tool-select").click();
  await drag(page, [1, 1], [1, 1]);
  await expect(page.getByTestId("pixel-selection")).toBeVisible();
  await drag(page, [1, 1], [4, 1]);
  expect(await pixelAt(canvas(page), 4, 1)).toEqual(hex(ORANGE));
  expect((await pixelAt(canvas(page), 1, 1))[3]).toBe(0);

  await page.getByTestId("pixel-add-layer").click();
  await expect(page.getByTestId("pixel-layer-1")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("pixel-tool-pencil").click();
  await pickColor(page, text.pixel.colors[GREEN]);
  await click(page, 3, 3);
  expect(await pixelAt(canvas(page), 3, 3)).toEqual(hex(GREEN));
  await page.getByTestId("pixel-layer-visible-1").click();
  expect((await pixelAt(canvas(page), 3, 3))[3]).toBe(0);
  expect(await pixelAt(canvas(page), 4, 1)).toEqual(hex(ORANGE));
  await page.getByTestId("pixel-layer-visible-1").click();
  expect(await pixelAt(canvas(page), 3, 3)).toEqual(hex(GREEN));

  await page.getByTestId("pixel-add-frame").click();
  await page.getByTestId("pixel-onion").check();
  // The canvas premultiplies alpha, so a channel can land one step away from the buffer.
  const fadedOrange = await pixelAt(canvas(page), 4, 1);
  const fadedGreen = await pixelAt(canvas(page), 3, 3);
  expect(fadedOrange[3]).toBe(102);
  expect(fadedGreen[3]).toBe(102);
  expect(Math.abs(fadedOrange[0] - 239)).toBeLessThanOrEqual(1);
  expect(Math.abs(fadedGreen[1] - 183)).toBeLessThanOrEqual(1);
  await page.getByTestId("pixel-onion").uncheck();
  expect((await pixelAt(canvas(page), 4, 1))[3]).toBe(0);

  const sheet = createPixels(8, 4);
  paint(sheet, 0, 0, ORANGE);
  paint(sheet, 4, 0, GREEN);
  await page.getByTestId("pixel-sheet-file").setInputFiles({
    name: "sheet.png",
    mimeType: "image/png",
    buffer: Buffer.from(encodePng(sheet)),
  });
  await expect(page.getByTestId("pixel-sheet-dialog")).toBeVisible();
  await page.getByTestId("pixel-sheet-width").fill("4");
  await page.getByTestId("pixel-sheet-height").fill("4");
  await page.getByTestId("pixel-sheet-confirm").click();
  await expect(page.getByTestId("pixel-sheet-dialog")).toHaveCount(0);
  await expect(canvas(page)).toHaveAttribute("data-width", "4");
  await expect(canvas(page)).toHaveAttribute("data-height", "4");
  expect(await pixelAt(canvas(page), 0, 0)).toEqual(hex(ORANGE));
  await page.getByTestId("pixel-frame-1").click();
  expect(await pixelAt(canvas(page), 0, 0)).toEqual(hex(GREEN));

  await page.getByTestId("pixel-undo").click();
  await expect(canvas(page)).toHaveAttribute("data-width", "16");
  await expect(page.getByTestId("pixel-frame-1")).toBeVisible();
  await page.getByTestId("pixel-frame-0").click();
  expect(await pixelAt(canvas(page), 4, 1)).toEqual(hex(ORANGE));
  expect(await pixelAt(canvas(page), 3, 3)).toEqual(hex(GREEN));
});
