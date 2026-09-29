import { expect, test, type Page } from "@playwright/test";
import { text } from "../../src/ui/text";

// Sign-in, authorization and the AI gate, end to end against the real Worker.
// Roles: anonymous, allowed account, signed in but not on the allowlist.

const ALLOWED = "kid@example.com";
const MODEL = "http://127.0.0.1:4199";
const MARKER = "# 小助手加的注释";

async function nextModelReply(page: Page, mode: "files" | "explain" | "broken") {
  const response = await page.request.post(`${MODEL}/__next`, { data: { mode } });
  expect(response.ok()).toBe(true);
}

async function openStudio(page: Page) {
  await page.goto("/");
  // Monaco renders lines progressively; wait for the starter game's body.
  await expect(page.locator(".monaco-editor .view-lines")).toContainText("pygame.init()");
}

async function signIn(page: Page, email: string) {
  await page.getByRole("button", { name: text.account.signIn, exact: true }).click();
  await page.getByLabel("GitHub 账号邮箱").fill(email);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => url.pathname === "/" && !url.search.includes("login="));
}

function aiMenu(page: Page) {
  return page.getByTestId("ai-menu");
}

async function openAiMenu(page: Page) {
  await page.getByRole("button", { name: "AI Tools" }).click();
  await expect(aiMenu(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await nextModelReply(page, "files");
});

test("anonymous: the studio works without any identity request, and AI asks to sign in", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url());
  });
  await openStudio(page);
  await expect(page.getByRole("button", { name: text.account.signIn, exact: true })).toBeVisible();
  await openAiMenu(page);
  await expect(aiMenu(page)).toContainText(text.ai.needsSignIn);
  await expect(aiMenu(page).getByRole("button", { name: "Fix error" })).toHaveCount(0);
  expect(apiCalls).toEqual([]);

  const direct = await page.request.post("/api/ai", { data: { op: "complete", messages: [{ role: "user", content: "hi" }] } });
  expect(direct.status()).toBe(401);
});

test("allowed account: signs in, gets a proposal, accepts it and undoes it", async ({ page }) => {
  await openStudio(page);
  await signIn(page, ALLOWED);
  await expect(page.locator(".account")).toContainText("kid");

  await openAiMenu(page);
  await aiMenu(page).getByRole("button", { name: "Fix error" }).click();
  const dialog = page.locator(".modal");
  await expect(dialog).toContainText("我在最上面加了一行注释");
  await expect(dialog).toContainText(MARKER);
  await dialog.getByRole("button", { name: "Accept" }).click();
  await expect(page.locator(".monaco-editor .view-lines")).toContainText("小助手加的注释");

  await openAiMenu(page);
  await aiMenu(page).getByRole("button", { name: "Undo last accepted change" }).click();
  await expect(page.locator(".monaco-editor .view-lines")).not.toContainText("小助手加的注释");
});

test("allowed account: a broken model answer changes nothing", async ({ page }) => {
  await openStudio(page);
  await signIn(page, ALLOWED);
  await expect(page.locator(".monaco-editor .view-lines")).toContainText("pygame.init()");
  const before = await page.locator(".monaco-editor .view-lines").innerText();
  await nextModelReply(page, "broken");
  await openAiMenu(page);
  await aiMenu(page).getByRole("button", { name: "Fix error" }).click();
  await expect(page.locator(".notice")).toBeVisible();
  await expect(page.locator(".modal")).toHaveCount(0);
  expect(await page.locator(".monaco-editor .view-lines").innerText()).toBe(before);
});

test("signed in but not allowed: told kindly, and AI stays locked", async ({ page }) => {
  await openStudio(page);
  await signIn(page, "stranger@example.com");
  await expect(page.locator(".notice")).toContainText(text.account.notes.denied);
  await expect(page.getByRole("button", { name: text.account.signIn, exact: true })).toBeVisible();
  await openAiMenu(page);
  await expect(aiMenu(page)).toContainText(text.ai.needsSignIn);

  const direct = await page.request.get("/api/me", { headers: { Cookie: "gamekit_dev_email=stranger@example.com" } });
  expect(direct.status()).toBe(403);
});

test("a lost session asks the child to sign in again and keeps the work", async ({ page, context }) => {
  await openStudio(page);
  await signIn(page, ALLOWED);
  await expect(page.locator(".account")).toContainText("kid");
  await expect(page.locator(".monaco-editor .view-lines")).toContainText("pygame.init()");
  const before = await page.locator(".monaco-editor .view-lines").innerText();

  await context.clearCookies();
  await openAiMenu(page);
  await aiMenu(page).getByRole("button", { name: "Fix error" }).click();
  await expect(page.locator(".notice")).toContainText(text.account.notes.expired);
  await expect(page.getByRole("button", { name: text.account.signIn, exact: true })).toBeVisible();
  expect(await page.locator(".monaco-editor .view-lines").innerText()).toBe(before);
});

test("sign-out returns to the anonymous studio", async ({ page }) => {
  await openStudio(page);
  await signIn(page, ALLOWED);
  await page.getByRole("button", { name: text.account.signOut }).click();
  await expect(page.locator(".notice")).toContainText(text.account.notes["signed-out"]);
  await expect(page.getByRole("button", { name: text.account.signIn, exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: text.account.signIn, exact: true })).toBeVisible();
});
