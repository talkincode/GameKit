import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { sha256Hex } from "../../src/lib/assets/hash";
import { projectFromArchive } from "../../src/lib/export";
import { auditExportedProject, auditWebArchive } from "../../src/lib/offline";
import { text } from "../../src/ui/text";
import { openProjectsPanel, openRecipes } from "./nav";

// 阶段 G：配方项目里再放入素材库副本、动画、地图和声音。
// 源码包和网页包都不请求 GameKit 或在线素材目录，文件 hash 和钉住的副本一致。
// 网页包仍要 pygame-web 运行时，导出菜单把这件事说出来。

const COIN = "assets/library/forest-adventure/props/coin.png";
const JUMP = "assets/library/forest-sounds/sounds/jump.wav";
const coinPng = readFileSync("public/asset-packs/forest-adventure/props/coin.png");
const jumpWav = readFileSync("public/asset-packs/forest-sounds/sounds/jump.wav");

function watchApi(page: Page) {
  const hits: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) hits.push(request.url());
  });
  return hits;
}

async function storedProjects(page: Page): Promise<{ id: string; name: string; files: { path: string; text?: string }[] }[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gamekit");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<{ id: string; name: string; files: { path: string; text?: string }[] }[]>((resolve, reject) => {
      const request = db.transaction("projects").objectStore("projects").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows;
  });
}

test("a recipe project with library, animation, map, and sound exports offline", async ({ page }) => {
  test.setTimeout(90_000);
  const hits = watchApi(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: text.stage.play })).toBeVisible();
  const starter = (await storedProjects(page))[0];
  const starterMain = starter.files.find((file) => file.path === "main.py")?.text ?? "";

  await openRecipes(page);
  await page.getByTestId("recipe-new-platform").click();
  await expect(page.getByTestId("recipes-dialog")).toHaveCount(0);
  await expect.poll(async () => (await storedProjects(page)).length).toBe(2);

  await page.getByTestId("library-open").click();
  await page.getByTestId("library-search").fill("金币");
  await page.getByTestId("library-asset-coin").click();
  await page.getByTestId("library-add").click();
  await expect(page.getByTestId("library-status")).toContainText(COIN);
  await page.getByTestId("library-search").fill("跳跃");
  await page.getByTestId("library-asset-jump-sfx").click();
  await page.getByTestId("library-add").click();
  await expect(page.getByTestId("library-status")).toContainText(JUMP);
  await page.getByTestId("library-dialog").getByRole("button", { name: text.library.close }).click();
  // The copy confirmation sits over the bottom of the next dialog until the child taps it.
  await page.getByTestId("notice").click();
  await expect(page.getByTestId("notice")).toHaveCount(0);

  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.code.assets, exact: true }).click();
  await page.getByTestId("sound-open").click();
  const sound = page.getByTestId("sound-dialog");
  await expect(sound.getByTestId("sound-preview")).toBeVisible();
  await sound.getByRole("button", { name: text.sounds.accept }).click();
  await expect(sound.getByTestId("sound-status")).toContainText("assets/jump.wav");
  await sound.getByRole("button", { name: text.sounds.close }).click();

  await page.getByRole("button", { name: text.code.files, exact: true }).click();
  await page.getByTestId("map-new").click();
  const mapDialog = page.getByTestId("map-new-dialog");
  await mapDialog.getByTestId("map-slug").fill("level-1");
  await mapDialog.getByTestId("map-size-small").click();
  await mapDialog.getByTestId("map-tile-size-16").click();
  await mapDialog.getByTestId("map-start").click();
  await expect(page.getByTestId("map-editor")).toBeVisible();
  await page.getByTestId("map-save").click();
  await expect(page.getByTestId("map-saved")).toContainText("maps/level-1.map.json");
  await page.getByTestId("map-close").click();

  await page.getByRole("button", { name: text.code.assets, exact: true }).click();
  await page.getByTestId("pixel-new").click();
  const pixelDialog = page.getByTestId("pixel-new-dialog");
  await pixelDialog.getByTestId("pixel-name").fill("walker");
  await pixelDialog.getByRole("button", { name: text.pixel.sizeValue(16) }).click();
  await pixelDialog.getByTestId("pixel-start").click();
  await expect(page.getByTestId("pixel-editor")).toBeVisible();
  await page.getByTestId("pixel-add-frame").click();
  await page.getByTestId("pixel-save").click();
  await expect(page.getByTestId("pixel-saved")).toContainText("assets/walker.png");
  await page.getByTestId("pixel-close").click();

  await page.getByRole("button", { name: text.header.export, exact: true }).click();
  await expect(page.getByTestId("export-offline-note")).toContainText("不打开 GameKit");
  await expect(page.getByRole("button", { name: new RegExp(text.export.web) })).toContainText("断网时网页版打不开");
  const [web] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: new RegExp(text.export.web) }).click(),
  ]);

  await openProjectsPanel(page);
  await expect(page.getByTestId("export-source-hint")).toContainText("不用联网找素材");
  const [source] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("projects-panel").getByRole("button", { name: text.project.exportSource, exact: true }).first().click(),
  ]);

  const sourceBytes = new Uint8Array(readFileSync(await source.path()));
  const webBytes = new Uint8Array(readFileSync(await web.path()));
  const restored = projectFromArchive("game-source.zip", sourceBytes);
  expect(await auditExportedProject(restored)).toEqual([]);
  expect(await auditWebArchive(webBytes, restored)).toEqual([]);

  const packed = unzipSync(sourceBytes);
  expect(Buffer.from(packed[COIN]).equals(Buffer.from(coinPng))).toBe(true);
  expect(Buffer.from(packed[JUMP]).equals(Buffer.from(jumpWav))).toBe(true);
  const pins = JSON.parse(new TextDecoder().decode(packed["assets/library.json"])) as { copies: { path: string; sha256: string }[] };
  expect(pins.copies.find((pin) => pin.path === COIN)?.sha256).toBe(await sha256Hex(packed[COIN]));
  expect(pins.copies.find((pin) => pin.path === JUMP)?.sha256).toBe(await sha256Hex(packed[JUMP]));
  expect(packed["assets/walker.png"]).toBeTruthy();
  expect(packed["assets/walker.anim.json"]).toBeTruthy();
  expect(packed["maps/level-1.map.json"]).toBeTruthy();
  expect(packed["maps/level-1.tileset.png"]).toBeTruthy();
  expect(packed["assets/jump.wav"]).toBeTruthy();
  expect(packed["recipe.json"]).toBeTruthy();
  const main = new TextDecoder().decode(packed["main.py"]);
  expect(main).toContain("RECIPE-OK");
  expect(main).not.toContain("/asset-packs/");
  expect(main).not.toContain("gamekit.talkincode.net");

  const kept = (await storedProjects(page)).find((project) => project.id === starter.id);
  expect(kept?.files.find((file) => file.path === "main.py")?.text).toBe(starterMain);
  expect(hits).toEqual([]);
});
