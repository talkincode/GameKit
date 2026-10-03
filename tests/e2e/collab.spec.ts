import { expect, test, type Page } from "@playwright/test";
import { text } from "../../src/ui/text";

const ALLOWED = "kid@example.com";

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByRole("button", { name: text.account.signIn, exact: true }).click();
  await page.getByLabel("GitHub 账号邮箱").fill(email);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => url.pathname === "/" && !url.search.includes("login="));
}

test("anonymous user cannot start MCP collaboration", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("stage")).toBeVisible();

  await page.getByTestId("settings-open").click();
  const panel = page.getByTestId("settings-panel");
  await expect(panel).toBeVisible();

  await expect(page.getByTestId("collab-status")).toContainText(text.collab.statusInactive);
  await page.getByTestId("collab-toggle").click();

  // Notice pops up requiring sign-in
  await expect(page.getByTestId("notice")).toContainText(text.collab.needsSignIn);
  await expect(page.getByTestId("collab-status")).toContainText(text.collab.statusInactive);
});

test("signed-in user can start collaboration, see active badge, and stop", async ({ page }) => {
  await signIn(page, ALLOWED);

  await page.getByTestId("settings-open").click();
  const panel = page.getByTestId("settings-panel");
  await expect(panel).toBeVisible();

  await expect(page.getByTestId("collab-status")).toContainText(text.collab.statusInactive);
  await page.getByTestId("collab-toggle").click();

  await expect(page.getByTestId("collab-status")).toContainText(text.collab.statusActive);
  await expect(page.getByTestId("collab-url-box")).toBeVisible();
  const urlInput = page.getByTestId("collab-url");
  await expect(urlInput).toHaveValue(new RegExp("/mcp$"));

  // Close settings; toolbar badge is visible
  await page.getByTestId("settings-close").click();
  const badge = page.getByTestId("collab-badge");
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(text.collab.badge);

  // Clicking badge reopens settings
  await badge.click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();

  // Stop collaboration
  await page.getByTestId("collab-toggle").click();
  await expect(page.getByTestId("collab-status")).toContainText(text.collab.statusInactive);
  await page.getByTestId("settings-close").click();
  await expect(page.getByTestId("collab-badge")).toHaveCount(0);
});

test("external MCP proposal appears as candidate, can be adopted and undone", async ({ page }) => {
  const COLLAB_MARKER = "# COLLAB_CODE_CHANGE_123";
  let servedCandidate = false;

  await page.route("**/api/collab/sync", async (route) => {
    if (!servedCandidate) {
      servedCandidate = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          candidates: [
            {
              id: "cand-test-1",
              tool: "cursor",
              say: "优化了游戏循环",
              files: [
                {
                  path: "main.py",
                  text: `import pygame\n${COLLAB_MARKER}\nprint('hello')\n`,
                },
              ],
              createdAt: Date.now(),
            },
          ],
          activity: [],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ candidates: [], activity: [] }),
    });
  });

  await signIn(page, ALLOWED);
  await page.getByTestId("settings-open").click();
  await page.getByTestId("collab-toggle").click();
  await page.getByTestId("settings-close").click();

  // The external proposal shows up as a candidate turn in the designer pane
  const turn = page.getByTestId("design-turn");
  await expect(turn).toContainText("优化了游戏循环", { timeout: 15_000 });
  await expect(page.getByTestId("candidate")).toBeVisible();
  await expect(page.getByTestId("adopt")).toBeVisible();

  // Candidate runs on the stage
  await expect(page.locator(".stage-badge")).toContainText(text.stage.candidate);

  // Adopt candidate
  await page.getByTestId("adopt").click();
  await expect(turn).toContainText(text.pane.adopted);

  // Code editor has the adopted changes
  await page.getByRole("tab", { name: text.header.code }).click();
  const editorLines = page.locator(".monaco-editor .view-lines");
  await expect(editorLines).toContainText(COLLAB_MARKER);

  // Undo restores previous version
  await page.getByRole("button", { name: text.header.undoShort }).click();
  await expect(editorLines).not.toContainText(COLLAB_MARKER);
});

test("external MCP proposal can be discarded without changing files", async ({ page }) => {
  const DISCARD_MARKER = "# DISCARDED_CODE_XYZ";
  let servedCandidate = false;

  await page.route("**/api/collab/sync", async (route) => {
    if (!servedCandidate) {
      servedCandidate = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          candidates: [
            {
              id: "cand-test-2",
              tool: "claude",
              say: "这是一次丢弃测试",
              files: [
                {
                  path: "main.py",
                  text: `import pygame\n${DISCARD_MARKER}\n`,
                },
              ],
              createdAt: Date.now(),
            },
          ],
          activity: [],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ candidates: [], activity: [] }),
    });
  });

  await signIn(page, ALLOWED);
  await page.getByTestId("settings-open").click();
  await page.getByTestId("collab-toggle").click();
  await page.getByTestId("settings-close").click();

  const turn = page.getByTestId("design-turn");
  await expect(turn).toContainText("这是一次丢弃测试", { timeout: 15_000 });
  await expect(page.getByTestId("candidate")).toBeVisible();

  // Discard candidate
  await page.getByTestId("discard").click();
  await expect(turn).toContainText(text.pane.discarded);

  // Check code editor: files are unchanged
  await page.getByRole("tab", { name: text.header.code }).click();
  const editorLines = page.locator(".monaco-editor .view-lines");
  await expect(editorLines).not.toContainText(DISCARD_MARKER);
});
