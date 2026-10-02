import { expect, test, type Page } from "@playwright/test";
import { text } from "../../src/ui/text";

// The agent loop end to end against the real Worker: idea → candidate → adopt.
// The model is the mock in tests/e2e/mock-model.mjs; the pygame runtime needs the
// CDN, so a round is expected to end as "unverified" here — the loop must hand the
// candidate over anyway and never guess that a missing frame is a code problem.

const ALLOWED = "kid@example.com";
const MODEL = "http://127.0.0.1:4199";
const MARKER = "# 小助手加的注释";
const IDEA = "做一个在太空里躲陨石的小方块游戏";

test.setTimeout(120_000);

async function nextModelReply(page: Page, mode: "clean" | "sleepy" | "broken") {
  const response = await page.request.post(`${MODEL}/__next`, { data: { mode } });
  expect(response.ok()).toBe(true);
}

async function openStudio(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("stage")).toBeVisible();
}

async function signIn(page: Page, email: string) {
  await page.getByRole("button", { name: text.account.signIn, exact: true }).click();
  await page.getByLabel("GitHub 账号邮箱").fill(email);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => url.pathname === "/" && !url.search.includes("login="));
}

/** Types an idea and waits for the round to finish. */
async function askForGame(page: Page, idea: string = IDEA) {
  await page.getByLabel(text.pane.placeholder).fill(idea);
  await page.getByRole("button", { name: text.pane.send }).click();
  await expect(page.getByTestId("candidate")).toBeVisible();
  await expect(page.getByTestId("adopt")).toBeVisible();
}

async function openCode(page: Page) {
  await page.getByRole("tab", { name: text.header.code }).click();
  return page.locator(".monaco-editor .view-lines");
}

test.beforeEach(async ({ page }) => {
  await nextModelReply(page, "clean");
});

test("an idea becomes a candidate, and the child adopts it", async ({ page }) => {
  await openStudio(page);
  await signIn(page, ALLOWED);
  await askForGame(page);

  // The round is described in the child's terms, with the design card.
  const turn = page.getByTestId("design-turn");
  await expect(turn).toContainText(IDEA);
  await expect(turn).toContainText("我打算做一个在太空里躲陨石的小游戏");
  await expect(page.getByTestId("turn-design")).toContainText("太空小方块");
  await expect(turn).toContainText(text.steps.design);
  await expect(turn).toContainText(text.steps.build);

  // The candidate runs on the stage; adopting is what changes the project.
  await expect(page.locator(".stage-badge")).toContainText(text.stage.candidate);
  await page.getByTestId("adopt").click();
  await expect(turn).toContainText(text.pane.adopted);

  const lines = await openCode(page);
  await expect(lines).toContainText(MARKER);

  await page.getByRole("button", { name: text.header.undo }).click();
  await expect(lines).not.toContainText(MARKER);
});

test("a candidate the checks reject is repaired before the child sees it", async ({ page }) => {
  await nextModelReply(page, "sleepy");
  await openStudio(page);
  await signIn(page, ALLOWED);
  await page.getByLabel(text.pane.placeholder).fill(IDEA);
  await page.getByRole("button", { name: text.pane.send }).click();

  const turn = page.getByTestId("design-turn");
  await expect(turn).toContainText(text.steps.repair, { timeout: 60_000 });
  await expect(page.getByTestId("adopt")).toBeVisible({ timeout: 60_000 });

  await page.getByTestId("adopt").click();
  const lines = await openCode(page);
  await expect(lines).toContainText(MARKER);
  await expect(lines).not.toContainText("time.sleep");
});

test("a broken model answer changes nothing", async ({ page }) => {
  await nextModelReply(page, "broken");
  await openStudio(page);
  await signIn(page, ALLOWED);
  const lines = await openCode(page);
  await expect(lines).toContainText("Signal Drift");

  await page.getByRole("tab", { name: text.header.design }).click();
  await page.getByLabel(text.pane.placeholder).fill(IDEA);
  await page.getByRole("button", { name: text.pane.send }).click();
  await expect(page.getByTestId("design-turn")).toContainText(text.pane.failed, { timeout: 60_000 });
  await expect(page.getByTestId("candidate")).toHaveCount(0);

  await page.getByRole("tab", { name: text.header.code }).click();
  await expect(lines).toContainText("Signal Drift");
  await expect(lines).not.toContainText(MARKER);
});

test("the child can stop a round and the project stays as it was", async ({ page }) => {
  await openStudio(page);
  await signIn(page, ALLOWED);
  const lines = await openCode(page);
  await expect(lines).toContainText("Signal Drift");

  await page.getByRole("tab", { name: text.header.design }).click();
  await page.getByLabel(text.pane.placeholder).fill(IDEA);
  await page.getByRole("button", { name: text.pane.send }).click();
  await page.getByRole("button", { name: text.pane.cancel }).click();
  await expect(page.getByTestId("design-turn")).toContainText(text.pane.cancelled, { timeout: 60_000 });
  await expect(page.getByTestId("adopt")).toHaveCount(0);

  await page.getByRole("tab", { name: text.header.code }).click();
  await expect(lines).toContainText("Signal Drift");
  await expect(lines).not.toContainText(MARKER);
});

test("a second sentence continues from the adopted game", async ({ page }) => {
  await openStudio(page);
  await signIn(page, ALLOWED);
  await askForGame(page);
  await page.getByTestId("adopt").click();
  await expect(page.getByTestId("design-turn").first()).toContainText(text.pane.adopted);

  // The next round builds on what the child adopted, and offers a fresh candidate.
  await page.getByLabel(text.pane.placeholder).fill("让陨石多一点");
  await page.getByRole("button", { name: text.pane.sendNext }).click();
  await expect(page.getByTestId("design-turn")).toHaveCount(2);
  await expect(page.getByTestId("adopt")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("adopt").last().click();

  const lines = await openCode(page);
  await expect(lines).toContainText("第 2 版");
});

test("a round that is still running cannot write into another project", async ({ page }) => {
  await openStudio(page);
  await signIn(page, ALLOWED);
  const lines = await openCode(page);
  await expect(lines).toContainText("Signal Drift");

  await page.getByRole("tab", { name: text.header.design }).click();
  await page.getByLabel(text.pane.placeholder).fill(IDEA);
  await page.getByRole("button", { name: text.pane.send }).click();
  // Switch projects while the round is in flight.
  await page.getByRole("button", { name: text.header.project }).click();
  await page.getByRole("button", { name: text.project.duplicate }).click();
  await page.waitForTimeout(200);

  // The new project keeps its own files, and the interrupted round is gone.
  await expect(page.getByTestId("design-turn")).toHaveCount(0);
  await expect(page.getByTestId("adopt")).toHaveCount(0);
  await page.getByRole("tab", { name: text.header.code }).click();
  await expect(lines).toContainText("Signal Drift");
  await expect(lines).not.toContainText(MARKER);
  await expect(lines).not.toContainText("太空小方块");
});

test("an anonymous child keeps the whole studio and makes no AI calls", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url());
  });
  await openStudio(page);

  // The starter game is there, the stage can run it, and the pane asks for a sign-in.
  await expect(page.getByTestId("current-design")).toContainText("信号漂流");
  await expect(page.getByRole("button", { name: text.stage.play })).toBeVisible();
  await expect(page.getByTestId("pane")).toContainText(text.ai.needsSignIn);
  await expect(page.getByLabel(text.pane.placeholder)).toHaveCount(0);
  await expect(page.getByRole("tab", { name: text.header.code })).toBeVisible();
  expect(apiCalls).toEqual([]);

  const direct = await page.request.post("/api/ai", { data: { op: "complete", messages: [{ role: "user", content: "hi" }] } });
  expect(direct.status()).toBe(401);
});
