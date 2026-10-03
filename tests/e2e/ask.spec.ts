import { expect, test, type Page } from "@playwright/test";
import { text } from "../../src/ui/text";

// The ask box: it grows with the text, and it can be talked to. Voice uses the
// Web Speech API, which no CI browser has, so the test installs a stand-in that
// behaves like the real one: one phrase, reported as final, then it ends.

const IDEA = "做一个会跳的小方块";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: text.account.signIn, exact: true }).click();
  await page.getByLabel("GitHub 账号邮箱").fill("kid@example.com");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => url.pathname === "/" && !url.search.includes("login="));
}

async function installVoice(page: Page, phrase: string) {
  await page.addInitScript((spoken) => {
    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error?: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        window.setTimeout(() => {
          this.onresult?.({
            resultIndex: 0,
            results: { 0: { 0: { transcript: spoken }, isFinal: true }, length: 1 },
          });
          this.onend?.();
        }, 50);
      }
      stop() {
        this.onend?.();
      }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  }, phrase);
}

test("the ask box grows with the text instead of scrolling", async ({ page }) => {
  await signIn(page);
  const box = page.getByLabel(text.pane.placeholder);
  const empty = (await box.boundingBox())?.height ?? 0;

  await box.fill("第一行");
  const oneLine = (await box.boundingBox())?.height ?? 0;
  await box.fill(["第一行", "第二行", "第三行"].join("\n"));
  const threeLines = (await box.boundingBox())?.height ?? 0;
  expect(oneLine).toBeLessThanOrEqual(empty);
  expect(threeLines).toBeGreaterThan(oneLine);

  // Long text stops growing and scrolls instead of pushing the pane apart.
  await box.fill(Array.from({ length: 20 }, (_, index) => `第 ${index + 1} 行`).join("\n"));
  const many = (await box.boundingBox())?.height ?? 0;
  expect(many).toBeLessThanOrEqual(170);
  const scrolls = await box.evaluate((node) => node.scrollHeight > node.clientHeight + 1);
  expect(scrolls).toBe(true);
});

test("the child can say the idea out loud", async ({ page }) => {
  await installVoice(page, IDEA);
  await signIn(page);

  const box = page.getByLabel(text.pane.placeholder);
  await expect(box).toHaveValue("");
  await page.getByTestId("mic").click();
  await expect(box).toHaveValue(IDEA, { timeout: 10_000 });
  await expect(page.locator(".ask-listening")).toHaveCount(0);

  // What was said is a draft the child can still edit before sending.
  await box.fill(`${IDEA}，要有星星`);
  await expect(page.getByRole("button", { name: text.pane.send })).toBeEnabled();
});

test("a browser without voice input simply has no microphone", async ({ page }) => {
  // Chromium ships the API, so the unsupported case is made explicit here.
  await page.addInitScript(() => {
    const scope = window as unknown as Record<string, unknown>;
    delete scope.SpeechRecognition;
    delete scope.webkitSpeechRecognition;
  });
  await signIn(page);
  await expect(page.getByLabel(text.pane.placeholder)).toBeVisible();
  await expect(page.getByTestId("mic")).toHaveCount(0);
  // Typing still works, and there is no broken button asking for a microphone.
  await page.getByLabel(text.pane.placeholder).fill("做一个会跳的小方块");
  await expect(page.getByRole("button", { name: text.pane.send })).toBeEnabled();
});
