import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { text } from "../../src/ui/text";

// Kenney CC0 精选：不登录、不调用 /api。打开素材库之后才加载。
// 复制进项目的是文件字节；舞台和导出都用这一份，不访问 kenney.nl。

const TILES = "assets/library/kenney-dungeon/tilesets/rooms.png";
const tilesPng = readFileSync("public/asset-packs/kenney-dungeon/tilesets/rooms.png");

function watchApi(page: Page) {
  const hits: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/") || path.startsWith("/asset-packs/")) hits.push(path);
  });
  return hits;
}

test("the first screen does not fetch asset packs", async ({ page }) => {
  const hits = watchApi(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: text.stage.play })).toBeVisible();
  expect(hits).toEqual([]);
});

test("searching finds a Kenney tileset, and pygame plus the export use the copy", async ({ page }) => {
  test.setTimeout(180_000);
  const hits = watchApi(page);
  await page.goto("/");
  await page.getByTestId("library-open").click();
  await expect(page.getByTestId("library-dialog")).toBeVisible();
  expect(hits.some((path) => path.startsWith("/api/"))).toBe(false);

  await page.getByTestId("library-search").fill("地牢图块");
  await expect(page.getByTestId("library-asset-dungeon-tiles")).toBeVisible();
  await expect(page.getByTestId("library-asset-hero")).toHaveCount(0);
  await page.getByTestId("library-asset-dungeon-tiles").click();
  await page.getByTestId("library-adult").locator("summary").click();
  await expect(page.getByTestId("library-license")).toContainText("CC0");
  await expect(page.getByTestId("library-author")).toContainText("Kenney");
  await expect(page.getByTestId("library-source")).toContainText("https://kenney.nl/assets/tiny-dungeon");
  await expect(page.getByTestId("library-size")).toContainText("64×64");

  await page.getByTestId("library-more").locator("summary").click();
  await page.getByTestId("library-try").click();
  await expect(page.getByTestId("library-main-preview")).toContainText(`pygame.image.load("${TILES}")`);
  await expect(page.getByTestId("library-main-preview")).not.toContainText("/asset-packs/");
  await expect(page.getByTestId("library-main-preview")).not.toContainText("kenney.nl");
  await page.getByTestId("library-confirm-main").click();
  await expect(page.getByTestId("library-status")).toContainText("main.py");
  expect(hits.some((path) => path.startsWith("/api/"))).toBe(false);

  await page.getByTestId("library-dialog").getByRole("button", { name: text.library.close }).click();
  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.stage.play }).click();
  await expect(page.locator(".console")).toContainText("async: ok", { timeout: 120_000 });
  await page.frameLocator(`iframe[title="${text.brand.name}"]`).locator("#canvas").click({ position: { x: 10, y: 10 }, force: true });
  await expect(page.locator(".console")).toContainText("LIBRARY-OK (64, 64)", { timeout: 120_000 });

  await page.getByRole("button", { name: text.header.project, exact: true }).click();
  const [source] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("projects-panel").getByRole("button", { name: text.project.exportSource, exact: true }).first().click(),
  ]);
  const packed = unzipSync(new Uint8Array(readFileSync(await source.path())));
  expect(Buffer.from(packed[TILES]).equals(Buffer.from(tilesPng))).toBe(true);
  const main = new TextDecoder().decode(packed["main.py"]);
  expect(main).toContain(`pygame.image.load("${TILES}")`);
  expect(main).not.toContain("/asset-packs/");
});

test("a dungeon sheet can start a map, a walker opens in the animation editor, and a sound can be heard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.code.files, exact: true }).click();
  await page.getByTestId("map-new").click();
  const map = page.getByTestId("map-new-dialog");
  await expect(map.getByTestId("map-tileset-dungeon-tiles")).toBeVisible();
  await map.getByTestId("map-tile-size-16").click();
  await map.getByTestId("map-tileset-dungeon-tiles").click();
  await map.getByTestId("map-start").click();
  await expect(page.getByTestId("map-editor")).toBeVisible();
  await expect(page.getByTestId("map-tile-1")).toHaveAttribute("aria-label", "棕色地砖");
  await page.getByTestId("map-close").click();

  await page.getByRole("button", { name: text.code.assets, exact: true }).click();
  await page.getByTestId("sound-open").click();
  const sound = page.getByTestId("sound-library-sfx-jump");
  await expect(sound).toBeVisible();
  await expect(sound).toHaveAttribute("src", /\/asset-packs\/kenney-sfx\/.+\.ogg$/);
  await page.getByTestId("sound-dialog").getByRole("button", { name: text.sounds.close }).click();

  await page.getByTestId("library-open-side").click();
  await page.getByTestId("library-asset-platform-walker").click();
  await page.getByTestId("library-open-sprite").click();
  await expect(page.getByTestId("pixel-editor")).toBeVisible();
  await expect(page.getByTestId("pixel-frame-duration")).toHaveValue("240");
});
