import { expect, test, type Page } from "@playwright/test";
import { text } from "../../src/ui/text";

// Sign-in, authorization and the AI gate, end to end against the real Worker.
// Roles: anonymous, allowed account, signed in but not on the allowlist.
// The agent loop itself is covered in agent.spec.ts.

const ALLOWED = "kid@example.com";
const MODEL = "http://127.0.0.1:4199";
const IDEA = "做一个会跳的小方块";

test.setTimeout(120_000);

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

async function openCode(page: Page) {
  await page.getByRole("tab", { name: text.header.code }).click();
  return page.locator(".monaco-editor .view-lines");
}

async function ask(page: Page, idea: string = IDEA) {
  await page.getByLabel(text.pane.placeholder).fill(idea);
  await page.getByRole("button", { name: text.pane.send }).click();
}

test.beforeEach(async ({ page }) => {
  const response = await page.request.post(`${MODEL}/__next`, { data: { mode: "clean" } });
  expect(response.ok()).toBe(true);
});

test("anonymous: the studio works without any identity request, and AI asks to sign in", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url());
  });
  await openStudio(page);
  await expect(page.getByRole("button", { name: text.account.signIn, exact: true })).toBeVisible();
  await expect(page.getByTestId("pane")).toContainText(text.ai.needsSignIn);
  await expect(page.getByLabel(text.pane.placeholder)).toHaveCount(0);
  // 看代码 and 试玩 belong to the child, signed in or not.
  await expect(page.getByRole("tab", { name: text.header.code })).toBeVisible();
  await expect(page.getByRole("button", { name: text.stage.play })).toBeVisible();
  expect(apiCalls).toEqual([]);

  const direct = await page.request.post("/api/ai", { data: { op: "complete", messages: [{ role: "user", content: "hi" }] } });
  expect(direct.status()).toBe(401);
});

test("allowed account: signs in and gets a candidate to try", async ({ page }) => {
  await openStudio(page);
  await signIn(page, ALLOWED);
  await expect(page.locator(".account")).toContainText("kid");

  await ask(page);
  await expect(page.getByTestId("candidate")).toBeVisible();
  await expect(page.getByTestId("adopt")).toBeVisible();
});

test("allowed account: 讲讲这段 reads code and never rewrites the project", async ({ page }) => {
  await openStudio(page);
  await signIn(page, ALLOWED);
  const lines = await openCode(page);
  await expect(lines).toContainText("pygame.init()");

  await page.getByTestId("explain").click();
  // The answer belongs in the conversation pane, so the view follows it there.
  await expect(page.getByTestId("explain-turn")).toContainText("这段代码让角色跳起来", { timeout: 60_000 });

  await page.getByRole("tab", { name: text.header.code }).click();
  await expect(lines).toContainText("pygame.init()");
  await expect(lines).not.toContainText("小助手加的注释");
});

test("signed in but not allowed: told kindly, and AI stays locked", async ({ page }) => {
  await openStudio(page);
  await signIn(page, "stranger@example.com");
  await expect(page.locator(".notice")).toContainText(text.account.notes.denied);
  await expect(page.getByRole("button", { name: text.account.signIn, exact: true })).toBeVisible();
  await expect(page.getByLabel(text.pane.placeholder)).toHaveCount(0);

  const direct = await page.request.get("/api/me", { headers: { Cookie: "gamekit_dev_email=stranger@example.com" } });
  expect(direct.status()).toBe(403);
});

test("a lost session asks the child to sign in again and keeps the work", async ({ page }) => {
  await openStudio(page);
  await signIn(page, ALLOWED);
  await expect(page.locator(".account")).toContainText("kid");
  const lines = await openCode(page);
  await expect(lines).toContainText("Signal Drift");

  await page.context().clearCookies();
  await page.getByRole("tab", { name: text.header.design }).click();
  await ask(page);
  await expect(page.locator(".notice")).toContainText(text.account.notes.expired, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: text.account.signIn, exact: true })).toBeVisible();

  await page.getByRole("tab", { name: text.header.code }).click();
  await expect(lines).toContainText("Signal Drift");
  await expect(lines).not.toContainText("小助手加的注释");
});

test("sign-out returns to the anonymous studio", async ({ page }) => {
  await openStudio(page);
  await signIn(page, ALLOWED);
  await page.getByRole("button", { name: text.account.signOut }).click();
  await expect(page.locator(".notice")).toContainText(text.account.notes["signed-out"]);
  await expect(page.getByRole("button", { name: text.account.signIn, exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: text.account.signIn, exact: true })).toBeVisible();
  await expect(page.getByTestId("stage")).toBeVisible();
});
