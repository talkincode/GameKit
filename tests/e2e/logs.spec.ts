import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ASSISTANT_SAY } from "../../shared/assistant-error";
import { text } from "../../src/ui/text";
import { openLogs } from "./nav";

const ALLOWED = "kid@example.com";
const MODEL = "http://127.0.0.1:4199";
const IDEA = "做一个在太空里躲陨石的小方块游戏";

test.setTimeout(120_000);

async function nextModelReply(page: Page, mode: "clean" | "rate") {
  const response = await page.request.post(`${MODEL}/__next`, { data: { mode } });
  expect(response.ok()).toBe(true);
}

async function signIn(page: Page) {
  await page.getByRole("button", { name: text.account.signIn, exact: true }).click();
  await page.getByLabel("GitHub 账号邮箱").fill(ALLOWED);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => url.pathname === "/" && !url.search.includes("login="));
}

test("anonymous: the log panel opens without an identity request", async ({ page }) => {
  const api: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) api.push(new URL(request.url()).pathname);
  });
  await page.goto("/");
  await expect(page.getByTestId("stage")).toBeVisible();
  await openLogs(page);
  await expect(page.getByTestId("logs-panel")).toBeVisible();
  await expect(page.getByTestId("logs-empty")).toHaveText(text.logs.empty);
  expect(api).toEqual([]);
  await page.getByRole("button", { name: text.logs.close }).click();
  await expect(page.getByTestId("logs-panel")).toHaveCount(0);
});

test("an upstream rate limit shows a detail link, a request id, and a local log row", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await nextModelReply(page, "rate");
  await page.goto("/");
  await signIn(page);
  await page.getByLabel(text.pane.placeholder).fill(IDEA);
  await page.getByRole("button", { name: text.pane.send }).click();

  const turn = page.getByTestId("design-turn");
  await expect(turn).toContainText(ASSISTANT_SAY.rate_limit, { timeout: 60_000 });
  await expect(turn).not.toContainText("e2e-key");
  await page.getByTestId("turn-error-detail-toggle").click();
  const requestId = (await page.getByTestId("turn-error-detail-request-id").innerText()).trim();
  expect(requestId).toMatch(/^gk_/);
  await expect(page.getByTestId("turn-error-detail-body")).toContainText("429");
  await expect(page.getByTestId("turn-error-detail-body")).toContainText("rate_limit");
  await expect(page.locator("body")).not.toContainText("e2e-key");
  try {
    mkdirSync("/opt/cursor/artifacts/screenshots", { recursive: true });
    await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/assistant-error-detail.png" });
  } catch {
    // Screenshots are for the pull request. The assertions above are the contract.
  }

  await page.getByTestId("turn-error-detail-copy").click();
  await expect(page.getByTestId("turn-error-detail-copy")).toHaveText(text.logs.copied);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(requestId);
  expect(copied).toContain("rate_limit");
  expect(copied).not.toContain("e2e-key");

  await openLogs(page);
  const row = page.locator(`[data-testid="log-row"][data-request-id="${requestId}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(ASSISTANT_SAY.rate_limit);

  await page.getByTestId("logs-filter-preview").click();
  await expect(row).toHaveCount(0);
  await page.getByTestId("logs-filter-assistant").click();
  await expect(row).toBeVisible();

  try {
    mkdirSync("/opt/cursor/artifacts/screenshots", { recursive: true });
    await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/assistant-log-panel.png" });
  } catch {
    // Screenshots are for the pull request. The assertions above are the contract.
  }

  await page.getByRole("button", { name: text.logs.close }).click();
  await page.reload();
  await openLogs(page);
  await expect(page.locator(`[data-testid="log-row"][data-request-id="${requestId}"]`)).toBeVisible();

  await page.getByTestId("logs-clear").click();
  await expect(page.getByTestId("logs-clear-ask")).toBeVisible();
  await page.getByTestId("logs-clear-confirm").click();
  await expect(page.getByTestId("logs-empty")).toBeVisible();
});
