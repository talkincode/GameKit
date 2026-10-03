import { expect, test, type Locator, type Page } from "@playwright/test";
import { strToU8, unzipSync, zipSync } from "fflate";
import { createPixels } from "../../src/lib/pixel/buffer";
import { encodePng } from "../../src/lib/pixel/png";
import { text } from "../../src/ui/text";

// 像素编辑器 / 新建图片：不登录、不要模型。The child draws on a real canvas, the PNG
// that lands in assets/ is read back from IndexedDB and decoded by the browser,
// and the failure paths (bad size, same name, unsaved close, a write that fails)
// each leave the picture and the project exactly as the child had them.

const ORANGE = "#ef7d57";
const GREEN = "#38b764";

async function openAssets(page: Page) {
  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.code.assets, exact: true }).click();
}

async function openNewDialog(page: Page) {
  await openAssets(page);
  await page.getByTestId("pixel-new").click();
  return page.getByTestId("pixel-new-dialog");
}

/** 新建图片 → pick a size → 开始画. */
async function startNew(page: Page, options: { size?: number; name?: string; solid?: string } = {}) {
  const dialog = await openNewDialog(page);
  if (options.name !== undefined) await dialog.getByTestId("pixel-name").fill(options.name);
  if (options.size) await dialog.getByRole("button", { name: text.pixel.sizeValue(options.size) }).click();
  if (options.solid) {
    await dialog.getByRole("button", { name: text.pixel.solid }).click();
    await dialog.getByRole("button", { name: text.pixel.colors[options.solid] }).click();
  }
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

/** Screen position of the middle of one picture pixel. */
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
  // One jump, on purpose: a fast pointer must still leave a continuous line.
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

async function save(page: Page) {
  await page.getByTestId("pixel-save").click();
}

type Stored = { base64: string; width: number; height: number; data: number[] };

/** The file as IndexedDB holds it, decoded by the browser's own PNG reader. */
async function stored(page: Page, path: string): Promise<Stored | null> {
  return page.evaluate(async (wanted) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gamekit");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<{ files: { path: string; base64?: string }[] }[]>((resolve, reject) => {
      const request = db.transaction("projects").objectStore("projects").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const file = rows.flatMap((row) => row.files).find((item) => item.path === wanted);
    if (!file?.base64) return null;
    const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const surface = document.createElement("canvas");
    surface.width = bitmap.width;
    surface.height = bitmap.height;
    const context = surface.getContext("2d") as CanvasRenderingContext2D;
    context.drawImage(bitmap, 0, 0);
    return {
      base64: file.base64,
      width: bitmap.width,
      height: bitmap.height,
      data: Array.from(context.getImageData(0, 0, bitmap.width, bitmap.height).data),
    };
  }, path);
}

function at(image: Stored, x: number, y: number): number[] {
  const index = (y * image.width + x) * 4;
  return image.data.slice(index, index + 4);
}

async function expectStored(page: Page, path: string): Promise<Stored> {
  await expect.poll(async () => (await stored(page, path)) !== null, { timeout: 10_000 }).toBe(true);
  return (await stored(page, path)) as Stored;
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: text.account.signIn, exact: true }).click();
  await page.getByLabel("GitHub 账号邮箱").fill("kid@example.com");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => url.pathname === "/" && !url.search.includes("login="));
}

test("anonymous: a new picture is drawn, saved as a PNG in assets/, used from code, and undone with 撤销", async ({ page }) => {
  const api: string[] = [];
  await page.goto("/");
  await expect(page.getByRole("tab", { name: text.header.code })).toBeVisible();
  await page.waitForLoadState("networkidle");
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) api.push(request.url());
  });

  const editor = await startNew(page, { size: 16 });
  await expect(page.getByTestId("pixel-title")).toHaveText(text.pixel.titleFor("assets/my-image.png", 16, 16));
  await expect(canvas(page)).toHaveAttribute("data-width", "16");
  await expect(canvas(page)).toHaveAttribute("data-height", "16");

  await pickColor(page, text.pixel.colors[ORANGE]);
  await click(page, 2, 3);
  await drag(page, [4, 4], [10, 4]);

  expect(await pixelAt(canvas(page), 2, 3)).toEqual(hex(ORANGE));
  for (let x = 4; x <= 10; x += 1) expect(await pixelAt(canvas(page), x, 4), `x=${x}`).toEqual(hex(ORANGE));
  expect((await pixelAt(canvas(page), 3, 4))[3]).toBe(0);
  expect((await pixelAt(canvas(page), 11, 4))[3]).toBe(0);
  // The 1:1 preview is the same picture.
  expect(await pixelAt(page.getByTestId("pixel-preview"), 7, 4)).toEqual(hex(ORANGE));
  await expect(editor).toContainText(text.pixel.dirty);

  await save(page);
  await expect(page.getByTestId("pixel-saved")).toContainText(text.pixel.saved("assets/my-image.png"));
  await expect(page.getByTestId("pixel-saved")).toContainText(text.pixel.use("assets/my-image.png"));
  await expect(editor).not.toContainText(text.pixel.dirty);

  const png = await expectStored(page, "assets/my-image.png");
  expect([png.width, png.height]).toEqual([16, 16]);
  expect(at(png, 2, 3)).toEqual(hex(ORANGE));
  expect(at(png, 7, 4)).toEqual(hex(ORANGE));
  expect(at(png, 0, 0)[3]).toBe(0);

  // Saved and unchanged: closing does not ask.
  await page.getByTestId("pixel-close").click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("button", { name: "assets/my-image.png", exact: true })).toBeVisible();

  // The project's one undo takes the new picture back out.
  await page.getByRole("button", { name: text.header.undoShort }).click();
  await expect(page.getByRole("button", { name: "assets/my-image.png", exact: true })).toHaveCount(0);
  await expect.poll(async () => stored(page, "assets/my-image.png")).toBeNull();

  expect(api).toEqual([]);
});

test("an existing PNG opens, 保存 overwrites it, and the project's 撤销 brings the original back", async ({ page }) => {
  await page.goto("/");
  const original = await expectStored(page, "assets/player.png");
  const editor = await edit(page, "assets/player.png");
  await expect(page.getByTestId("pixel-title")).toHaveText(text.pixel.titleFor("assets/player.png", 32, 32));

  // The editor shows exactly what is in the file.
  const shown = await Promise.all([0, 5, 16, 31].map((x) => pixelAt(canvas(page), x, x)));
  expect(shown).toEqual([0, 5, 16, 31].map((x) => at(original, x, x)));

  // Nothing changed yet: nothing to save.
  await expect(page.getByTestId("pixel-save")).toBeDisabled();

  await page.getByTestId("pixel-custom-color").fill("#ff00ff");
  await expect(page.getByTestId("pixel-color")).toHaveAttribute("data-hex", "#ff00ff");
  await click(page, 0, 0);
  await expect(editor).toContainText(text.pixel.dirty);
  await save(page);
  await expect(page.getByTestId("pixel-saved")).toContainText("assets/player.png");

  await expect
    .poll(async () => (await stored(page, "assets/player.png"))?.base64 !== original.base64, { timeout: 10_000 })
    .toBe(true);
  const changed = (await stored(page, "assets/player.png")) as Stored;
  expect(at(changed, 0, 0)).toEqual([255, 0, 255, 255]);
  // Every other pixel is exactly as it was.
  expect(changed.data.slice(4)).toEqual(original.data.slice(4));

  await page.getByTestId("pixel-close").click();
  await page.getByRole("button", { name: text.header.undoShort }).click();
  await expect.poll(async () => (await stored(page, "assets/player.png"))?.base64, { timeout: 10_000 }).toBe(original.base64);
});

test("另存为新图片 never touches the original", async ({ page }) => {
  await page.goto("/");
  const original = await expectStored(page, "assets/player.png");
  const editor = await edit(page, "assets/player.png");
  await pickColor(page, text.pixel.colors[GREEN]);
  await click(page, 1, 1);

  await page.getByTestId("pixel-save-as").click();
  const dialog = page.getByTestId("pixel-saveas-dialog");
  await expect(dialog.getByTestId("pixel-saveas-name")).toHaveValue("assets/player-2.png");

  // The original's own name is refused, with a way forward, and nothing is written.
  await dialog.getByTestId("pixel-saveas-name").fill("assets/player.png");
  await expect(dialog.getByTestId("pixel-saveas-taken")).toContainText("assets/player-2.png");
  await expect(dialog.getByTestId("pixel-saveas-confirm")).toBeDisabled();
  await dialog.getByRole("button", { name: text.pixel.useName("assets/player-2.png") }).click();
  await dialog.getByTestId("pixel-saveas-confirm").click();

  await expect(page.getByTestId("pixel-saved")).toContainText(text.pixel.saved("assets/player-2.png"));
  await expect(page.getByTestId("pixel-title")).toHaveText(text.pixel.titleFor("assets/player-2.png", 32, 32));
  const copy = await expectStored(page, "assets/player-2.png");
  expect(at(copy, 1, 1)).toEqual(hex(GREEN));
  expect((await stored(page, "assets/player.png"))?.base64).toBe(original.base64);

  // Further 保存 now goes to the copy, not the original.
  await click(page, 2, 2);
  await save(page);
  await expect.poll(async () => at((await stored(page, "assets/player-2.png")) as Stored, 2, 2)).toEqual(hex(GREEN));
  expect((await stored(page, "assets/player.png"))?.base64).toBe(original.base64);
  await page.getByTestId("pixel-close").click();
  await expect(editor).toHaveCount(0);
});

test("a size that is not allowed is refused with a short sentence, and the editor does not open", async ({ page }) => {
  await page.goto("/");
  const dialog = await openNewDialog(page);
  const problem = dialog.getByTestId("pixel-size-problem");

  await dialog.getByTestId("pixel-width").fill("0");
  await expect(problem).toHaveText(text.pixel.sizeSmall(text.pixel.width));
  await dialog.getByTestId("pixel-width").fill("257");
  await expect(problem).toHaveText(text.pixel.sizeBig(text.pixel.width, 256));
  await dialog.getByTestId("pixel-width").fill("abc");
  await expect(problem).toHaveText(text.pixel.sizeNumber(text.pixel.width));
  await dialog.getByTestId("pixel-width").fill("16");
  await dialog.getByTestId("pixel-height").fill("3.5");
  await expect(problem).toHaveText(text.pixel.sizeNumber(text.pixel.height));
  await dialog.getByTestId("pixel-height").fill("-2");
  await expect(problem).toHaveText(text.pixel.sizeSmall(text.pixel.height));

  await dialog.getByTestId("pixel-start").click();
  await expect(page.getByTestId("pixel-editor")).toHaveCount(0);
  await expect(dialog).toBeVisible();

  // Custom sizes up to the limit are fine, and need not be square.
  await dialog.getByTestId("pixel-width").fill("24");
  await dialog.getByTestId("pixel-height").fill("256");
  await expect(problem).toHaveCount(0);
  await dialog.getByTestId("pixel-start").click();
  await expect(canvas(page)).toHaveAttribute("data-width", "24");
  await expect(canvas(page)).toHaveAttribute("data-height", "256");
});

test("a name that is taken is never overwritten; a number is added instead", async ({ page }) => {
  await page.goto("/");
  const original = await expectStored(page, "assets/player.png");
  const dialog = await openNewDialog(page);

  await dialog.getByTestId("pixel-name").fill("assets/player.png");
  await expect(dialog.getByTestId("pixel-name-taken")).toContainText("assets/player-2.png");
  await dialog.getByTestId("pixel-start").click();
  await expect(page.getByTestId("pixel-editor")).toHaveCount(0);

  await dialog.getByTestId("pixel-name").fill("a?b");
  await expect(dialog.getByTestId("pixel-name-problem")).toHaveText(text.pixel.nameBad);
  await dialog.getByTestId("pixel-start").click();
  await expect(page.getByTestId("pixel-editor")).toHaveCount(0);

  await dialog.getByTestId("pixel-name").fill("assets/player.png");
  await dialog.getByRole("button", { name: text.pixel.useName("assets/player-2.png") }).click();
  await expect(dialog.getByTestId("pixel-name")).toHaveValue("assets/player-2.png");
  await dialog.getByTestId("pixel-start").click();
  await expect(page.getByTestId("pixel-title")).toHaveText(text.pixel.titleFor("assets/player-2.png", 32, 32));
  await click(page, 3, 3);
  await save(page);
  await expectStored(page, "assets/player-2.png");
  expect((await stored(page, "assets/player.png"))?.base64).toBe(original.base64);
  await page.getByTestId("pixel-close").click();

  // The next new picture starts from the next free name, and a bare name goes to assets/ as a .png.
  const again = await openNewDialog(page);
  await expect(again.getByTestId("pixel-name")).toHaveValue("assets/my-image.png");
  await again.getByTestId("pixel-name").fill("fox");
  await again.getByTestId("pixel-start").click();
  await expect(page.getByTestId("pixel-title")).toContainText("assets/fox.png");
});

test("closing with unsaved changes asks first; 继续画 keeps the drawing, 不保存 drops it, 保存 keeps it", async ({ page }) => {
  await page.goto("/");
  const editor = await startNew(page, { size: 16, name: "assets/ask.png" });
  await pickColor(page, text.pixel.colors[ORANGE]);
  await click(page, 5, 5);

  // Escape and the close button both ask.
  await page.keyboard.press("Escape");
  const ask = page.getByTestId("pixel-unsaved");
  await expect(ask).toBeVisible();
  await page.getByTestId("pixel-keep").click();
  await expect(ask).toHaveCount(0);
  expect(await pixelAt(canvas(page), 5, 5)).toEqual(hex(ORANGE));

  await page.getByTestId("pixel-close").click();
  await expect(ask).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ask).toHaveCount(0);
  await expect(editor).toBeVisible();
  expect(await pixelAt(canvas(page), 5, 5)).toEqual(hex(ORANGE));

  await page.getByTestId("pixel-close").click();
  await page.getByTestId("pixel-discard").click();
  await expect(editor).toHaveCount(0);
  expect(await stored(page, "assets/ask.png")).toBeNull();
  await expect(page.getByRole("button", { name: "assets/ask.png", exact: true })).toHaveCount(0);

  // 保存 from the question writes it, then closes.
  await startNew(page, { size: 16, name: "assets/ask.png" });
  await pickColor(page, text.pixel.colors[GREEN]);
  await click(page, 6, 6);
  await page.getByTestId("pixel-close").click();
  await page.getByTestId("pixel-save-close").click();
  await expect(editor).toHaveCount(0);
  const png = await expectStored(page, "assets/ask.png");
  expect(at(png, 6, 6)).toEqual(hex(GREEN));
});

test("a write that fails keeps the canvas, says so kindly, and the next 保存 works", async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if ((window as unknown as { gkFailPut?: boolean }).gkFailPut) throw new DOMException("disk full", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await page.goto("/");
  const editor = await startNew(page, { size: 16, name: "assets/flaky.png" });
  await pickColor(page, text.pixel.colors[ORANGE]);
  await drag(page, [1, 1], [8, 1]);

  await page.evaluate(() => {
    (window as unknown as { gkFailPut: boolean }).gkFailPut = true;
  });
  await save(page);
  await expect(page.getByTestId("pixel-problem")).toHaveText(text.pixel.failed["write-failed"]);
  // Nothing was claimed: still unsaved, still drawn, no file, no undo step.
  await expect(editor).toHaveAttribute("data-dirty", "true");
  await expect(page.getByTestId("pixel-saved")).toHaveCount(0);
  for (let x = 1; x <= 8; x += 1) expect(await pixelAt(canvas(page), x, 1)).toEqual(hex(ORANGE));
  expect(await stored(page, "assets/flaky.png")).toBeNull();
  await expect(page.getByTitle(text.header.undo)).toBeDisabled();

  // Closing now still asks, and 继续画 returns to the same canvas.
  await page.getByTestId("pixel-close").click();
  await expect(page.getByTestId("pixel-unsaved")).toBeVisible();
  await page.getByTestId("pixel-save-close").click();
  await expect(page.getByTestId("pixel-unsaved").getByRole("alert")).toHaveText(text.pixel.failed["write-failed"]);
  await page.getByTestId("pixel-keep").click();
  expect(await pixelAt(canvas(page), 4, 1)).toEqual(hex(ORANGE));

  await page.evaluate(() => {
    (window as unknown as { gkFailPut: boolean }).gkFailPut = false;
  });
  await save(page);
  await expect(page.getByTestId("pixel-saved")).toContainText(text.pixel.saved("assets/flaky.png"));
  await expect(page.getByTestId("pixel-problem")).toHaveCount(0);
  const png = await expectStored(page, "assets/flaky.png");
  expect(at(png, 4, 1)).toEqual(hex(ORANGE));
  await expect(page.getByTitle(text.header.undo)).toBeEnabled();
});

test("tools: pencil, eraser, bucket, picker, clear, and undo / redo with the keyboard", async ({ page }) => {
  await page.goto("/");
  await startNew(page, { size: 16, name: "assets/tools.png" });
  const tool = (name: string) => page.getByRole("button", { name, exact: true });

  await expect(tool(text.pixel.pencil)).toHaveAttribute("aria-pressed", "true");
  await pickColor(page, text.pixel.colors[ORANGE]);
  await expect(page.getByTestId("pixel-color")).toHaveAttribute("data-hex", ORANGE);
  await expect(page.getByTestId("pixel-color")).toHaveAttribute("aria-label", text.pixel.currentIs(text.pixel.colors[ORANGE]));

  // A wall down the middle, then the bucket fills one side only.
  await drag(page, [8, 0], [8, 15]);
  await tool(text.pixel.fill).click();
  await expect(tool(text.pixel.fill)).toHaveAttribute("aria-pressed", "true");
  await expect(tool(text.pixel.pencil)).toHaveAttribute("aria-pressed", "false");
  await pickColor(page, text.pixel.colors[GREEN]);
  await click(page, 2, 2);
  expect(await pixelAt(canvas(page), 0, 0)).toEqual(hex(GREEN));
  expect(await pixelAt(canvas(page), 7, 15)).toEqual(hex(GREEN));
  expect(await pixelAt(canvas(page), 8, 7)).toEqual(hex(ORANGE));
  expect((await pixelAt(canvas(page), 9, 0))[3]).toBe(0);
  expect((await pixelAt(canvas(page), 15, 15))[3]).toBe(0);

  // Undo is one step for the whole fill; redo brings it back.
  await page.keyboard.press("ControlOrMeta+z");
  expect((await pixelAt(canvas(page), 0, 0))[3]).toBe(0);
  expect(await pixelAt(canvas(page), 8, 7)).toEqual(hex(ORANGE));
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await pixelAt(canvas(page), 0, 0)).toEqual(hex(GREEN));
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+y");
  expect(await pixelAt(canvas(page), 0, 0)).toEqual(hex(GREEN));

  // The picker takes a colour from the picture and goes back to the pencil.
  await tool(text.pixel.picker).click();
  await click(page, 8, 3);
  await expect(page.getByTestId("pixel-color")).toHaveAttribute("data-hex", ORANGE);
  await expect(tool(text.pixel.pencil)).toHaveAttribute("aria-pressed", "true");
  await tool(text.pixel.picker).click();
  await click(page, 12, 12);
  await expect(page.getByTestId("pixel-color")).toHaveAttribute("data-hex", "transparent");

  // The eraser makes pixels transparent whatever colour is chosen.
  await pickColor(page, text.pixel.colors[ORANGE]);
  await tool(text.pixel.eraser).click();
  await click(page, 0, 0);
  expect((await pixelAt(canvas(page), 0, 0))[3]).toBe(0);
  expect(await pixelAt(canvas(page), 1, 0)).toEqual(hex(GREEN));

  // Clearing is a step you can take back.
  await page.getByTestId("pixel-clear").click();
  expect((await pixelAt(canvas(page), 8, 7))[3]).toBe(0);
  expect((await pixelAt(canvas(page), 1, 0))[3]).toBe(0);
  await page.getByTestId("pixel-undo").click();
  expect(await pixelAt(canvas(page), 8, 7)).toEqual(hex(ORANGE));
  expect(await pixelAt(canvas(page), 1, 0)).toEqual(hex(GREEN));

  // A right-click is not a stroke.
  await tool(text.pixel.pencil).click();
  const point = await cellPoint(page, 13, 13);
  await page.mouse.click(point.x, point.y, { button: "right" });
  expect((await pixelAt(canvas(page), 13, 13))[3]).toBe(0);

  // The transparent swatch paints holes with the pencil.
  await pickColor(page, text.pixel.transparentColor);
  await expect(page.getByTestId("pixel-color")).toHaveAttribute("data-hex", "transparent");
  await click(page, 8, 7);
  expect((await pixelAt(canvas(page), 8, 7))[3]).toBe(0);
});

test("the view: grid line switch, whole-number zoom, solid background, and every tool is a named button", async ({ page }) => {
  await page.goto("/");
  await startNew(page, { size: 16, name: "assets/view.png", solid: "#a7f070" });
  expect(await pixelAt(canvas(page), 0, 0)).toEqual(hex("#a7f070"));
  expect(await pixelAt(canvas(page), 15, 15)).toEqual(hex("#a7f070"));

  await expect(page.getByTestId("pixel-grid")).toHaveCount(1);
  await page.getByTestId("pixel-grid-toggle").uncheck();
  await expect(page.getByTestId("pixel-grid")).toHaveCount(0);

  const scale = Number(await canvas(page).getAttribute("data-scale"));
  await page.getByRole("button", { name: text.pixel.zoomOut }).click();
  const smaller = Number(await canvas(page).getAttribute("data-scale"));
  expect(smaller).toBeLessThan(scale);
  expect(Number.isInteger(smaller)).toBe(true);
  const box = await canvas(page).boundingBox();
  expect(box?.width).toBe(16 * smaller);
  await expect(canvas(page)).toHaveCSS("image-rendering", "pixelated");

  // Keyboard users reach and operate the tools.
  const eraser = page.getByRole("button", { name: text.pixel.eraser, exact: true });
  await eraser.focus();
  await page.keyboard.press("Enter");
  await expect(eraser).toHaveAttribute("aria-pressed", "true");
  for (const name of [text.pixel.pencil, text.pixel.fill, text.pixel.picker, text.pixel.clear, text.pixel.undo, text.pixel.redo]) {
    await expect(page.getByTestId("pixel-editor").getByRole("button", { name, exact: true })).toBeVisible();
  }
});

test("touch and pen can draw, and a second finger does not break the stroke", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 820, height: 900 } });
  const page = await context.newPage();
  await page.goto("/");
  await startNew(page, { size: 16, name: "assets/touch.png" });
  await pickColor(page, text.pixel.colors[ORANGE]);
  const client = await context.newCDPSession(page);

  const from = await cellPoint(page, 2, 2);
  const to = await cellPoint(page, 12, 2);
  const other = await cellPoint(page, 6, 10);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: to.x, y: to.y, id: 1 }] });
  // A second finger lands somewhere else and lifts: it must not paint or end the first stroke.
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: to.x, y: to.y, id: 1 },
      { x: other.x, y: other.y, id: 2 },
    ],
  });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [{ x: to.x, y: to.y, id: 1 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  for (let x = 2; x <= 12; x += 1) expect(await pixelAt(canvas(page), x, 2), `touch x=${x}`).toEqual(hex(ORANGE));
  expect((await pixelAt(canvas(page), 6, 10))[3]).toBe(0);

  await pickColor(page, text.pixel.colors[GREEN]);
  const penFrom = await cellPoint(page, 3, 6);
  const penTo = await cellPoint(page, 9, 6);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: penFrom.x, y: penFrom.y, button: "left", buttons: 1, clickCount: 1, pointerType: "pen" });
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: penTo.x, y: penTo.y, button: "left", buttons: 1, pointerType: "pen" });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: penTo.x, y: penTo.y, button: "left", buttons: 0, clickCount: 1, pointerType: "pen" });
  for (let x = 3; x <= 9; x += 1) expect(await pixelAt(canvas(page), x, 6), `pen x=${x}`).toEqual(hex(GREEN));

  // The page does not scroll or zoom under the drawing hand.
  await expect(page.locator(".pixel-board")).toHaveCSS("touch-action", "none");
  await context.close();
});

test("a drawn picture is in the exported zips, byte for byte", async ({ page }) => {
  await page.goto("/");
  await startNew(page, { size: 16, name: "assets/export.png" });
  await pickColor(page, text.pixel.colors[ORANGE]);
  await drag(page, [1, 1], [14, 1]);
  await save(page);
  const png = await expectStored(page, "assets/export.png");
  await page.getByTestId("pixel-close").click();
  const bytes = Uint8Array.from(Buffer.from(png.base64, "base64"));

  await page.getByRole("button", { name: text.header.project, exact: true }).click();
  const [source] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("projects-panel").getByRole("button", { name: text.project.exportSource, exact: true }).first().click(),
  ]);
  const files = unzipSync(new Uint8Array(await (await import("node:fs/promises")).readFile(await source.path())));
  expect(Buffer.from(files["assets/export.png"]).equals(Buffer.from(bytes))).toBe(true);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: text.header.export, exact: true }).click();
  const [web] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: new RegExp(text.export.web) }).click()]);
  const outer = unzipSync(new Uint8Array(await (await import("node:fs/promises")).readFile(await web.path())));
  const inner = unzipSync(outer["gamekit.apk"]);
  expect(Buffer.from(inner["assets/assets/export.png"]).equals(Buffer.from(bytes))).toBe(true);
});

test("pygame in the preview loads the pictures that were drawn and edited", async ({ page }) => {
  test.setTimeout(180_000);
  // Monaco takes no typing in a headless browser, so the game comes in as an imported project.
  const game = [
    "import asyncio",
    "import pygame",
    "",
    "pygame.init()",
    "screen = pygame.display.set_mode((320, 240))",
    'hero = pygame.image.load("assets/hero.png")',
    'fresh = pygame.image.load("assets/my-image.png")',
    'print("PIXEL-EDITOR-OK", fresh.get_size(), tuple(fresh.get_at((2, 3))), tuple(fresh.get_at((0, 0))), tuple(hero.get_at((1, 1))))',
    "",
    "",
    "async def main():",
    "    while True:",
    "        screen.fill((20, 20, 40))",
    "        screen.blit(fresh, (10, 10))",
    "        screen.blit(hero, (60, 10))",
    "        pygame.display.flip()",
    "        await asyncio.sleep(0)",
    "",
    "",
    "asyncio.run(main())",
    "",
  ].join("\n");
  const hero = encodePng(createPixels(8, 8, [56, 183, 100, 255]));
  const archive = Buffer.from(zipSync({ "main.py": strToU8(game), "assets/hero.png": hero }));

  await page.goto("/");
  await page.getByRole("button", { name: text.header.project, exact: true }).click();
  await page.getByTestId("projects-panel").locator('input[type="file"]').setInputFiles({ name: "pixel-game.zip", mimeType: "application/zip", buffer: archive });
  await expect(page.getByTestId("projects-panel")).toHaveCount(0);

  // A new picture, and a touch-up on a picture that came with the project.
  await startNew(page, { size: 16, name: "assets/my-image.png" });
  await pickColor(page, text.pixel.colors[ORANGE]);
  await click(page, 2, 3);
  await save(page);
  await page.getByTestId("pixel-close").click();

  await edit(page, "assets/hero.png");
  await pickColor(page, text.pixel.colors[ORANGE]);
  await click(page, 1, 1);
  await save(page);
  await page.getByTestId("pixel-close").click();

  await page.getByRole("button", { name: text.stage.play }).click();
  // pygbag holds the game until the page gets a click or touch.
  await expect(page.locator(".console")).toContainText("async: ok", { timeout: 120_000 });
  await page.frameLocator(`iframe[title="${text.brand.name}"]`).locator("body").click({ force: true });
  await expect(page.locator(".console")).toContainText("PIXEL-EDITOR-OK (16, 16) (239, 125, 87, 255) (0, 0, 0, 0) (239, 125, 87, 255)", { timeout: 120_000 });
});

test("a generated picture can be touched up at the pixel level and saved as its own file", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route("**/api/ai", async (route) => {
    if (!(route.request().postData() ?? "").includes('"op":"image"')) {
      await route.fallback();
      return;
    }
    const png = await page.evaluate(() => {
      const surface = document.createElement("canvas");
      surface.width = 64;
      surface.height = 64;
      const context = surface.getContext("2d") as CanvasRenderingContext2D;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 64, 64);
      context.fillStyle = "#cc2222";
      context.fillRect(16, 26, 32, 12);
      return surface.toDataURL("image/png").split(",")[1];
    });
    await route.fulfill({ json: { image: png, mediaType: "image/png" } });
  });
  await signIn(page);
  await openAssets(page);
  await page.getByRole("button", { name: text.code.generate }).click();
  const dialog = page.getByTestId("asset-dialog");
  await dialog.getByRole("textbox").fill("小狐狸");
  await dialog.getByRole("button", { name: text.assets.generate }).click();
  await expect(dialog.locator("img.generated")).toBeVisible({ timeout: 60_000 });

  // Back out without drawing: the generated picture is still waiting in its dialog.
  await dialog.getByTestId("pixel-edit-draft").click();
  await expect(dialog).toHaveCount(0);
  const editor = page.getByTestId("pixel-editor");
  await expect(page.getByTestId("pixel-title")).toContainText("48×48");
  await page.getByTestId("pixel-close").click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId("asset-dialog")).toBeVisible();

  await page.getByTestId("pixel-edit-draft").click();
  await expect(page.getByTestId("pixel-title")).toContainText("48×48");
  expect((await pixelAt(canvas(page), 2, 2))[3]).toBe(0);
  expect((await pixelAt(canvas(page), 24, 24))[3]).toBe(255);
  await pickColor(page, text.pixel.colors[GREEN]);
  await click(page, 0, 0);
  await save(page);
  const title = (await page.getByTestId("pixel-title").textContent()) ?? "";
  const path = /assets\/sprite-\d+\.png/.exec(title)?.[0] ?? "";
  expect(path).not.toBe("");
  const png = await expectStored(page, path);
  expect(at(png, 0, 0)).toEqual(hex(GREEN));
  await page.getByTestId("pixel-close").click();

  // Saved: the picture is a project file now, and the maker has nothing left to keep.
  await expect(page.getByTestId("asset-dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: path, exact: true })).toBeVisible();
});
