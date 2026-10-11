import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { text } from "../../src/ui/text";
import { openProjectsPanel, signOut } from "./nav";

// 声音资产：the model picks numbers (stubbed at the network boundary), the browser
// renders the samples, and the child hears exactly the file that will be stored.

const PATCH = JSON.stringify({
  say: "这是一个跳起来的声音。",
  name: "jump-coin",
  layers: [
    { wave: "square", from: 660, to: 1320, gain: 0.4, attack: 0.005, decay: 0.08, sustain: 0.2, release: 0.12, duration: 0.25 },
  ],
});

const SCORE = JSON.stringify({
  say: "一段太空里的循环音乐。",
  name: "space-loop",
  bpm: 120,
  bars: 2,
  root: 57,
  scale: "minor",
  chords: [1, 5],
  tracks: [{ wave: "triangle", gain: 0.3, role: "lead", octave: 0 }],
});

async function stubSound(page: Page, reply: string) {
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postData() ?? "";
    if (!body.includes('"op":"sound"')) {
      await route.fallback();
      return;
    }
    await route.fulfill({ json: { text: reply } });
  });
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: text.account.signIn, exact: true }).click();
  await page.getByLabel("GitHub 账号邮箱").fill("kid@example.com");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => url.pathname === "/" && !url.search.includes("login="));
}

async function openSounds(page: Page) {
  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.code.assets, exact: true }).click();
  await page.getByTestId("sound-open").click();
  return page.getByTestId("sound-dialog");
}

test("a sound effect is rendered, played, and saved into assets/", async ({ page }) => {
  await stubSound(page, PATCH);
  await signIn(page);
  const dialog = await openSounds(page);

  await dialog.getByRole("textbox").fill("跳起来的声音");
  await dialog.getByRole("button", { name: text.sounds.generate }).click();

  const audio = dialog.getByTestId("sound-preview");
  await expect(audio).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText(text.sounds.seconds("0.3"));
  await expect(dialog).toContainText(text.sounds.use("assets/jump-coin.wav"));

  // The preview really is a playable WAV of the right length, not a placeholder.
  const wav = await audio.evaluate(async (node: HTMLAudioElement) => {
    const blob = await fetch(node.src).then((response) => response.blob());
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    return {
      riff: String.fromCharCode(...bytes.subarray(0, 4)),
      rate: view.getUint32(24, true),
      dataBytes: view.getUint32(40, true),
      type: blob.type,
    };
  });
  expect(wav).toEqual({ riff: "RIFF", rate: 22_050, dataBytes: Math.ceil(0.25 * 22_050) * 2, type: "audio/wav" });

  await dialog.getByRole("button", { name: text.sounds.accept }).click();
  await dialog.getByRole("button", { name: text.sounds.close }).click();
  await page.getByRole("button", { name: text.code.files, exact: true }).click();
  await expect(page.locator(".tree")).toContainText("jump-coin.wav");

  await page.getByRole("button", { name: text.header.undoShort }).click();
  await expect(page.locator(".tree")).not.toContainText("jump-coin.wav");
});

test("a music loop is exactly as long as the score says", async ({ page }) => {
  await stubSound(page, SCORE);
  await signIn(page);
  const dialog = await openSounds(page);
  await dialog.getByRole("button", { name: text.sounds.kinds.music, exact: true }).click();
  await dialog.getByRole("textbox").fill("太空里的背景音乐");
  await dialog.getByRole("button", { name: text.sounds.generate }).click();

  const audio = dialog.getByTestId("sound-preview");
  await expect(audio).toBeVisible({ timeout: 30_000 });
  // 2 bars of 4/4 at 120bpm = 4.0 seconds.
  await expect(dialog).toContainText(text.sounds.seconds("4.0"));
  const frames = await audio.evaluate(async (node: HTMLAudioElement) => {
    const bytes = new Uint8Array(await fetch(node.src).then((r) => r.arrayBuffer()));
    return new DataView(bytes.buffer).getUint32(40, true);
  });
  expect(frames).toBe(4 * 22_050 * 2);

  await dialog.getByRole("button", { name: text.sounds.accept }).click();
  await dialog.getByRole("button", { name: text.sounds.close }).click();
  await page.getByRole("button", { name: text.code.files, exact: true }).click();
  await expect(page.locator(".tree")).toContainText("space-loop.wav");
});

test("an anonymous child cannot generate sound", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url());
  });
  await signIn(page);
  await signOut(page);
  // Only what happens while anonymous counts; signing in may have asked the
  // Worker about the model earlier.
  const before = apiCalls.length;
  const dialog = await openSounds(page);
  await dialog.getByRole("textbox").fill("跳起来的声音");
  await dialog.getByRole("button", { name: text.sounds.generate }).click();
  await expect(page.getByTestId("sound-dialog")).toHaveCount(0);
  await expect(page.locator(".notice")).toContainText(text.ai.needsSignIn);
  expect(apiCalls.slice(before)).toEqual([]);
});

async function storedFile(page: Page, path: string): Promise<string | null> {
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
    return file?.base64 ?? null;
  }, path);
}

async function previewWav(page: Page) {
  return page.getByTestId("sound-preview").evaluate(async (node: HTMLAudioElement) => {
    const bytes = new Uint8Array(await fetch(node.src).then((response) => response.arrayBuffer()));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
}

test("a preset is heard and saved as the same wav, without asking the model", async ({ page }) => {
  const hits: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) hits.push(request.url());
  });
  await page.goto("/");
  const dialog = await openSounds(page);
  await expect(dialog.getByTestId("sound-wave")).toBeVisible();
  await expect(dialog.getByTestId("sound-envelope")).toBeVisible();
  await expect(dialog.getByTestId("sound-preview")).toBeVisible();
  await expect(dialog.getByTestId("sound-snippet")).toContainText('pygame.mixer.Sound("assets/jump.wav")');

  const heard = await previewWav(page);
  await dialog.getByRole("button", { name: text.sounds.accept }).click();
  await expect(dialog.getByTestId("sound-status")).toContainText("assets/jump.wav");
  expect(await storedFile(page, "assets/jump.wav")).toBe(heard);
  expect(hits).toEqual([]);

  await dialog.getByRole("button", { name: text.sounds.close }).click();
  await page.getByRole("button", { name: text.header.undoShort }).click();
  await expect.poll(async () => storedFile(page, "assets/jump.wav")).toBeNull();
});

test("a failed save leaves the project alone, and the next save works", async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if ((window as unknown as { gkFailPut?: boolean }).gkFailPut) throw new DOMException("disk full", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await page.goto("/");
  const dialog = await openSounds(page);
  await page.evaluate(() => {
    (window as unknown as { gkFailPut: boolean }).gkFailPut = true;
  });
  await dialog.getByRole("button", { name: text.sounds.accept }).click();
  await expect(dialog.getByTestId("sound-problem")).toHaveText(text.sounds.problem["write-failed"]);
  expect(await storedFile(page, "assets/jump.wav")).toBeNull();
  await expect(page.getByTitle(text.header.undo)).toBeDisabled();

  await page.evaluate(() => {
    (window as unknown as { gkFailPut: boolean }).gkFailPut = false;
  });
  const heard = await previewWav(page);
  await dialog.getByRole("button", { name: text.sounds.accept }).click();
  await expect(dialog.getByTestId("sound-status")).toContainText("assets/jump.wav");
  expect(await storedFile(page, "assets/jump.wav")).toBe(heard);
});

test("an mp3 is diagnosed, and a kept sound shows up in the library", async ({ page }) => {
  await page.goto("/");
  const dialog = await openSounds(page);
  await dialog.getByTestId("sound-keep").click();
  await expect(dialog.getByTestId("sound-status")).toContainText(text.sounds.kept);
  await dialog.getByRole("button", { name: text.sounds.close }).click();

  await page.locator(".side-tools input[type=file]").setInputFiles({
    name: "theme.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from("ID3"),
  });
  await page.getByRole("button", { name: text.code.problems }).click();
  await expect(page.locator(".problems")).toContainText("MP3");

  await page.getByTestId("library-open").click();
  await page.getByRole("button", { name: "我的声音", exact: true }).click();
  await expect(page.getByTestId("library-preview")).toBeVisible();
  await page.getByTestId("library-adult").locator("summary").click();
  await expect(page.getByTestId("library-author")).toContainText("你");
  await expect(page.getByTestId("library-license")).toContainText("CC0");
  await page.getByTestId("library-remove-kept").click();
  await page.getByTestId("library-remove-kept-confirm").click();
  await expect(page.getByTestId("library-status")).toContainText(text.library.removedKept);
});

test("an official sound plays in pygame and is inside the offline export", async ({ page }) => {
  test.setTimeout(180_000);
  const hits: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) hits.push(request.url());
  });
  const packedWav = readFileSync("public/asset-packs/forest-sounds/sounds/jump.wav");
  const path = "assets/library/forest-sounds/sounds/jump.wav";
  await page.goto("/");
  await page.getByTestId("library-open").click();
  await expect(page.getByTestId("library-category-sfx")).toBeVisible();
  await page.getByTestId("library-category-sfx").click();
  await page.getByTestId("library-asset-jump-sfx").click();
  await page.getByTestId("library-code").locator("summary").click();
  await expect(page.getByTestId("library-snippet")).toContainText(`pygame.mixer.Sound("${path}")`);
  await expect(page.getByTestId("library-snippet")).not.toContainText("/asset-packs/");
  await expect(page.getByTestId("library-related").getByRole("button", { name: "轻跳", exact: true })).toBeVisible();
  await expect(page.getByTestId("library-variant")).toHaveCount(0);
  await page.getByTestId("library-asset-jump-soft").click();
  await expect(page.getByTestId("library-variant")).toBeVisible();

  await page.getByTestId("library-asset-jump-sfx").click();
  await page.getByTestId("library-more").locator("summary").click();
  await page.getByTestId("library-try").click();
  await expect(page.getByTestId("library-main-preview")).toContainText("SOUND-OK");
  await expect(page.getByTestId("library-main-preview")).toContainText("await asyncio.sleep(0)");
  await page.getByTestId("library-confirm-main").click();
  await expect(page.getByTestId("library-status")).toContainText("main.py");
  expect(hits).toEqual([]);

  await page.getByTestId("library-dialog").getByRole("button", { name: text.library.close }).click();
  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.stage.play }).click();
  await expect(page.locator(".console")).toContainText("async: ok", { timeout: 120_000 });
  await page.frameLocator(`iframe[title="${text.brand.name}"]`).locator("#canvas").click({ position: { x: 10, y: 10 }, force: true });
  await expect(page.locator(".console")).toContainText("SOUND-OK", { timeout: 120_000 });

  await openProjectsPanel(page);
  const [source] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("projects-panel").getByRole("button", { name: text.project.exportSource, exact: true }).first().click(),
  ]);
  const packed = unzipSync(new Uint8Array(readFileSync(await source.path())));
  expect(Buffer.from(packed[path]).equals(Buffer.from(packedWav))).toBe(true);
  expect(new TextDecoder().decode(packed["main.py"])).toContain(`pygame.mixer.Sound("${path}")`);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: text.header.export, exact: true }).click();
  const [web] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: new RegExp(text.export.web) }).click(),
  ]);
  const outer = unzipSync(new Uint8Array(readFileSync(await web.path())));
  const inner = unzipSync(outer["gamekit.apk"]);
  expect(Buffer.from(inner[`assets/${path}`]).equals(Buffer.from(packedWav))).toBe(true);
});
