import { expect, test, type Page } from "@playwright/test";
import { text } from "../../src/ui/text";

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
  await page.getByRole("button", { name: text.code.files, exact: true }).click();
  await expect(page.locator(".tree")).toContainText("jump-coin.wav");

  await page.getByRole("button", { name: text.header.undoShort }).click();
  await expect(page.locator(".tree")).not.toContainText("jump-coin.wav");
});

test("a music loop is exactly as long as the score says", async ({ page }) => {
  await stubSound(page, SCORE);
  await signIn(page);
  const dialog = await openSounds(page);
  await dialog.getByRole("button", { name: text.sounds.kinds.music }).click();
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
  await page.getByRole("button", { name: text.code.files, exact: true }).click();
  await expect(page.locator(".tree")).toContainText("space-loop.wav");
});

test("an anonymous child cannot generate sound", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url());
  });
  await signIn(page);
  await page.getByRole("button", { name: text.account.signOut }).click();
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
