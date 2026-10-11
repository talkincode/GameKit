import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { strToU8, unzipSync, zipSync } from "fflate";
import { createPixels } from "../../src/lib/pixel/buffer";
import { encodePng } from "../../src/lib/pixel/png";
import { text } from "../../src/ui/text";

// 内置素材库：不登录、不调用 /api。包在打开素材库之后才加载。
// 复制进项目的是文件字节；同名要先选，撤销能回到旧的那一份。

const HERO = "assets/library/forest-adventure/characters/hero.png";
const libraryPng = readFileSync("public/asset-packs/forest-adventure/characters/hero.png");

function watchPack(page: Page) {
  const hits: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/") || path.startsWith("/asset-packs/")) hits.push(path);
  });
  return hits;
}

async function openLibrary(page: Page) {
  await page.getByTestId("library-open").click();
  await expect(page.getByTestId("library-dialog")).toBeVisible();
  await expect(page.getByTestId("library-asset-hero")).toBeVisible();
}

async function storedFile(page: Page, path: string): Promise<string | null> {
  return page.evaluate(async (wanted) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gamekit");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<{ files: { path: string; base64?: string }[]; trash?: { file: { path: string } }[] }[]>((resolve, reject) => {
      const request = db.transaction("projects").objectStore("projects").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const file = rows.flatMap((row) => row.files).find((item) => item.path === wanted);
    return file?.base64 ?? null;
  }, path);
}

test("an anonymous child can browse the library without loading it up front", async ({ page }) => {
  const hits = watchPack(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: text.stage.play })).toBeVisible();
  expect(hits).toEqual([]);

  await openLibrary(page);
  await page.getByTestId("library-search").fill("金币");
  await expect(page.getByTestId("library-asset-coin")).toBeVisible();
  await expect(page.getByTestId("library-asset-hero")).toHaveCount(0);
  await page.getByTestId("library-search").fill("");
  await page.getByTestId("library-category-character").click();
  await expect(page.getByTestId("library-asset-hero")).toBeVisible();
  await expect(page.getByTestId("library-asset-coin")).toHaveCount(0);

  await page.getByTestId("library-asset-hero").click();
  await expect(page.getByTestId("library-preview")).toBeVisible();
  await page.getByTestId("library-adult").locator("summary").click();
  await expect(page.getByTestId("library-license")).toContainText("CC0");
  await expect(page.getByTestId("library-author")).toContainText("GameKit");
  await expect(page.getByTestId("library-source")).toContainText("https://github.com/talkincode/GameKit");
  await expect(page.getByTestId("library-attribution")).not.toBeEmpty();
  await expect(page.getByTestId("library-size")).toContainText("64×32");
  await page.getByTestId("library-code").locator("summary").click();
  await expect(page.getByTestId("library-snippet")).toContainText(`pygame.image.load("${HERO}")`);

  expect(hits.some((path) => path === "/asset-packs/index.json")).toBe(true);
  expect(hits.some((path) => path === "/asset-packs/forest-adventure/manifest.json")).toBe(true);
  expect(hits.some((path) => path.endsWith("/characters/hero.png"))).toBe(true);
  expect(hits.some((path) => path.startsWith("/api/"))).toBe(false);

  await page.getByTestId("library-dialog").getByRole("button", { name: text.library.close }).click();
  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.code.assets, exact: true }).click();
  await page.getByTestId("library-open-side").click();
  await expect(page.getByTestId("library-dialog")).toBeVisible();
});

test("copying pins a file, a second copy does nothing, and undo removes it", async ({ page }) => {
  await page.goto("/");
  await openLibrary(page);
  await page.getByTestId("library-add").click();
  await expect(page.getByTestId("library-status")).toContainText(HERO);
  await expect.poll(async () => storedFile(page, HERO)).not.toBeNull();
  const first = await storedFile(page, HERO);
  expect(first).toBe(Buffer.from(libraryPng).toString("base64"));

  await page.getByTestId("library-add").click();
  await expect(page.getByTestId("library-status")).toContainText("没有再复制");
  expect(await storedFile(page, HERO)).toBe(first);

  await page.getByTestId("library-dialog").getByRole("button", { name: text.library.close }).click();
  await page.getByRole("button", { name: text.header.undoShort, exact: true }).click();
  await expect.poll(async () => storedFile(page, HERO)).toBeNull();
});

test("a same-path file is kept or replaced, and undo puts the old bytes back", async ({ page }) => {
  const old = encodePng(createPixels(2, 2, [200, 40, 40, 255]));
  const archive = Buffer.from(
    zipSync({
      "main.py": strToU8("print('keep')\n"),
      [HERO]: old,
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: text.header.project, exact: true }).click();
  await page.getByTestId("projects-panel").locator('input[type="file"]').setInputFiles({
    name: "clash.zip",
    mimeType: "application/zip",
    buffer: archive,
  });
  await expect(page.getByTestId("projects-panel")).toHaveCount(0);

  await openLibrary(page);
  await page.getByTestId("library-add").click();
  const conflict = page.getByTestId("library-conflict");
  await expect(conflict).toBeVisible();
  await conflict.getByRole("button", { name: text.library.keep }).click();
  await expect(page.getByTestId("library-status")).toContainText("保留");
  expect(await storedFile(page, HERO)).toBe(Buffer.from(old).toString("base64"));

  await page.getByTestId("library-add").click();
  await page.getByTestId("library-replace").click();
  await expect.poll(async () => storedFile(page, HERO)).toBe(Buffer.from(libraryPng).toString("base64"));

  await page.getByTestId("library-dialog").getByRole("button", { name: text.library.close }).click();
  await page.getByRole("button", { name: text.header.undoShort, exact: true }).click();
  await expect.poll(async () => storedFile(page, HERO)).toBe(Buffer.from(old).toString("base64"));
});

test("trashing a copied picture can be restored from the trash", async ({ page }) => {
  await page.goto("/");
  await openLibrary(page);
  await page.getByTestId("library-add").click();
  await expect.poll(async () => storedFile(page, HERO)).not.toBeNull();
  await page.getByTestId("library-dialog").getByRole("button", { name: text.library.close }).click();

  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: `${text.code.delete} hero.png` }).click();
  await page.getByTestId("delete-confirm").getByRole("button", { name: text.code.trashConfirm }).click();
  await expect.poll(async () => storedFile(page, HERO)).toBeNull();

  await page.getByTestId("trash").getByRole("button").first().click();
  await page.getByRole("button", { name: text.code.restore }).click();
  await expect.poll(async () => storedFile(page, HERO)).toBe(Buffer.from(libraryPng).toString("base64"));
});

test("the copied picture runs in pygame and is inside the offline export", async ({ page }) => {
  test.setTimeout(180_000);
  const hits = watchPack(page);
  await page.goto("/");
  await openLibrary(page);
  await page.getByTestId("library-more").locator("summary").click();
  await page.getByTestId("library-try").click();
  await expect(page.getByTestId("library-main-preview")).toContainText("pygame.image.load");
  await expect(page.getByTestId("library-main-preview")).not.toContainText("/asset-packs/");
  await page.getByTestId("library-confirm-main").click();
  await expect(page.getByTestId("library-status")).toContainText("main.py");
  expect(hits.some((path) => path.startsWith("/api/"))).toBe(false);

  await page.getByTestId("library-dialog").getByRole("button", { name: text.library.close }).click();
  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.stage.play }).click();
  await expect(page.locator(".console")).toContainText("async: ok", { timeout: 120_000 });
  await page.frameLocator(`iframe[title="${text.brand.name}"]`).locator("#canvas").click({ position: { x: 10, y: 10 }, force: true });
  await expect(page.locator(".console")).toContainText("LIBRARY-OK (32, 32)", { timeout: 120_000 });

  await page.getByRole("button", { name: text.header.project, exact: true }).click();
  const [source] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("projects-panel").getByRole("button", { name: text.project.exportSource, exact: true }).first().click(),
  ]);
  const packed = unzipSync(new Uint8Array(readFileSync(await source.path())));
  expect(Buffer.from(packed[HERO]).equals(Buffer.from(libraryPng))).toBe(true);
  const main = new TextDecoder().decode(packed["main.py"]);
  expect(main).toContain(`pygame.image.load("${HERO}")`);
  expect(main).not.toContain("/asset-packs/");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: text.header.export, exact: true }).click();
  const [web] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: new RegExp(text.export.web) }).click(),
  ]);
  const outer = unzipSync(new Uint8Array(readFileSync(await web.path())));
  const inner = unzipSync(outer["gamekit.apk"]);
  expect(Buffer.from(inner[`assets/${HERO}`]).equals(Buffer.from(libraryPng))).toBe(true);
});

test("sound cards show names, filters are unique, and the player has a duration", async ({ page }) => {
  const hits: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) hits.push(request.url());
  });
  await page.goto("/");
  await openLibrary(page);
  const overlapped = await page.locator(".library-card").evaluateAll((nodes) => {
    const boxes = nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
    });
    let count = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1) count += 1;
      }
    }
    return count;
  });
  expect(overlapped).toBe(0);
  await page.getByTestId("library-category-sfx").click();

  const cards = await page.locator(".library-card").evaluateAll((nodes) =>
    nodes.map((node) => {
      const name = node.querySelector(".library-name");
      const pack = node.querySelector(".library-pack");
      const card = node.getBoundingClientRect();
      const box = name?.getBoundingClientRect();
      return {
        name: name?.textContent?.trim() ?? "",
        pack: pack?.textContent?.trim() ?? "",
        inside: !!box && box.height > 8 && box.top >= card.top - 1 && box.bottom <= card.bottom + 1,
      };
    }),
  );
  expect(cards.length).toBeGreaterThan(10);
  expect(cards.every((card) => card.name.length > 0 && card.pack.length > 0 && card.inside)).toBe(true);

  await page.getByTestId("library-filters-more").click();
  const labels = await page.locator(".library-filters button").evaluateAll((buttons) =>
    buttons.map((button) => button.textContent?.trim() ?? "").filter((label) => label && !["全部", "更多", "收起"].includes(label)),
  );
  expect(new Set(labels).size).toBe(labels.length);
  for (const label of ["音效", "角色", "界面", "地形", "益智", "平台跳跃", "迷宫地牢", "音乐", "图块", "特效", "道具"]) {
    expect(labels.filter((item) => item === label)).toEqual([label]);
  }

  await expect(page.getByTestId("library-audio-duration")).toContainText("秒");
  await expect.poll(async () => page.getByTestId("library-preview").evaluate((el: HTMLAudioElement) => el.duration)).toBeGreaterThan(0);
  await expect(page.getByTestId("library-preview")).toHaveAttribute("src", /\.wav$/);
  await expect(page.getByTestId("library-preview")).toHaveAttribute("data-preview", "original");

  await page.getByTestId("library-asset-sfx-boom").click();
  await expect.poll(async () => page.getByTestId("library-preview").evaluate((el: HTMLAudioElement) => el.currentSrc)).toContain("boom.ogg");
  await expect.poll(async () => page.getByTestId("library-preview").evaluate((el: HTMLAudioElement) => el.duration)).toBeGreaterThan(0.5);
  await expect(page.getByTestId("library-audio-duration")).toContainText("秒");
  await expect(page.getByTestId("library-audio-unsupported")).toHaveCount(0);
  await expect.poll(async () => page.getByTestId("library-preview").evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThan(0);

  await page.getByTestId("library-asset-sfx-laser").click();
  await expect.poll(async () => page.getByTestId("library-preview").evaluate((el: HTMLAudioElement) => el.currentSrc)).toContain("laser.ogg");
  await expect.poll(async () => page.getByTestId("library-preview").evaluate((el: HTMLAudioElement) => el.duration)).toBeGreaterThan(0.5);

  await page.getByTestId("library-filter-all").click();
  await page.getByTestId("library-theme-平台跳跃").click();
  await expect(page.getByTestId("library-asset-platform-walker")).toBeVisible();
  await expect(page.getByTestId("library-asset-sfx-boom")).toHaveCount(0);
  await expect(page.getByTestId("library-asset-hero")).toHaveCount(0);
  expect(hits).toEqual([]);
});

test("the detail panel leads with one action and keeps the rest folded", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/");
  await openLibrary(page);

  const add = page.getByTestId("library-add");
  await expect(add).toBeVisible();
  await expect(add).toHaveText(text.library.add);
  await expect(add).toBeInViewport();
  await expect(page.getByTestId("library-intro")).toContainText("角色");
  await expect(page.getByTestId("library-code")).not.toHaveAttribute("open");
  await expect(page.getByTestId("library-adult")).not.toHaveAttribute("open");
  await expect(page.getByTestId("library-snippet")).toBeHidden();
  await expect(page.getByTestId("library-open-sprite")).toBeVisible();

  await page.getByTestId("library-more").locator("summary").click();
  const menu = page.getByTestId("library-more-menu");
  for (const label of [text.library.openSprite, text.library.try, text.library.saveExample, text.library.copyCode, text.library.propose]) {
    await expect(menu.getByRole("button", { name: label, exact: true })).toBeVisible();
  }

  const wrapped = await page.getByTestId("library-actions").evaluate((el) => {
    const previous = el.style.width;
    el.style.width = "160px";
    const nodes = [...el.querySelectorAll(":scope > button, :scope > details > summary")] as HTMLElement[];
    const top = el.getBoundingClientRect().top;
    const tops = nodes.map((node) => Math.round(node.getBoundingClientRect().top - top));
    const heights = nodes.map((node) => node.getBoundingClientRect().height);
    const texts = nodes.map((node) => node.textContent ?? "");
    const whites = nodes.map((node) => getComputedStyle(node).whiteSpace);
    el.style.width = previous;
    return { tops, heights, texts, whites, rows: new Set(tops).size };
  });
  expect(wrapped.rows).toBeGreaterThan(1);
  expect(wrapped.heights.every((height) => height < 50)).toBe(true);
  expect(wrapped.whites.every((space) => space === "nowrap")).toBe(true);
  expect(wrapped.texts.every((label) => !label.includes("\n"))).toBe(true);

  await page.getByTestId("library-more").locator("summary").click();
  await page.getByTestId("library-code").locator("summary").click();
  await page.getByTestId("library-adult").locator("summary").click();
  await page.getByTestId("library-detail-scroll").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByTestId("library-add")).toBeInViewport();

  await page.getByTestId("library-category-sfx").click();
  await page.getByTestId("library-asset-jump-sfx").click();
  await expect(page.getByTestId("library-add")).toBeVisible();
  await expect(page.getByTestId("library-hear")).toBeVisible();
  await expect(page.getByTestId("library-open-sprite")).toHaveCount(0);
  await expect(page.getByTestId("library-code")).not.toHaveAttribute("open");
  await expect(page.getByTestId("library-intro")).toContainText("声音");
  await page.getByTestId("library-more").locator("summary").click();
  const soundMenu = page.getByTestId("library-more-menu");
  for (const label of [text.library.hear, text.library.try, text.library.saveExample, text.library.copyCode, text.library.propose]) {
    await expect(soundMenu.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await expect(soundMenu.getByRole("button", { name: text.library.openSprite })).toHaveCount(0);
  await page.getByTestId("library-hear").click();
  await expect.poll(async () => page.getByTestId("library-preview").evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThan(0);

  await page.getByTestId("library-filter-all").click();
  await page.getByTestId("library-search").fill("地牢图块");
  await page.getByTestId("library-asset-dungeon-tiles").click();
  await expect(page.getByTestId("library-add")).toBeVisible();
  await expect(page.getByTestId("library-hear")).toHaveCount(0);
  await expect(page.getByTestId("library-open-sprite")).toHaveCount(0);
  await expect(page.getByTestId("library-intro")).toContainText("图块");
  await expect(page.getByTestId("library-code")).not.toHaveAttribute("open");

  await page.getByTestId("library-search").fill("爱心");
  await page.getByTestId("library-asset-heart").click();
  await expect(page.getByTestId("library-add")).toBeVisible();
  await expect(page.getByTestId("library-open-sprite")).toHaveCount(0);
  await expect(page.getByTestId("library-intro")).toContainText("图标");
});
