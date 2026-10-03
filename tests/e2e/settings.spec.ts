import { expect, test, type Page } from "@playwright/test";
import { text } from "../../src/ui/text";

// 设置：the assistant's memory budget follows the model unless the child picks a
// number, and the choice survives a reload. Also the session itself: a project's
// conversation is loaded back when the project is opened again.

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: text.account.signIn, exact: true }).click();
  await page.getByLabel("GitHub 账号邮箱").fill("kid@example.com");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => url.pathname === "/" && !url.search.includes("login="));
}

test("the memory budget is configurable, follows the model by default, and sticks", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("settings-open").click();
  const panel = page.getByTestId("settings-panel");
  await expect(panel).toBeVisible();

  // 自动 is the default and names the model's own window.
  await expect(page.getByTestId("budget-auto")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("budget-auto")).toContainText("自动");
  await expect(page.getByTestId("settings-summary")).toContainText(text.settings.tokens(96_000));

  await panel.getByRole("radio", { name: new RegExp(`${text.settings.tokens(64_000)}`) }).click();
  await expect(page.getByTestId("settings-summary")).toContainText(text.settings.tokens(64_000));

  await page.getByTestId("settings-close").click();
  await expect(panel).toHaveCount(0);
  await page.reload();
  await page.getByTestId("settings-open").click();
  await expect(page.getByTestId("settings-summary")).toContainText(text.settings.tokens(64_000));
});

test("a project's conversation is loaded back when it is opened again", async ({ page }) => {
  const seen: string[][] = [];
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postData() ?? "";
    if (!body.includes('"op":"complete"')) {
      await route.fallback();
      return;
    }
    const parsed = JSON.parse(body) as { messages: { role: string; content: unknown }[] };
    seen.push(parsed.messages.map((message) => (typeof message.content === "string" ? message.content : "(parts)")));
    const users = parsed.messages.filter((message) => message.role === "user");
    const asked = String(users.at(-1)?.content ?? "");
    await route.fulfill({
      json: {
        text: asked.includes('"hero"')
          ? JSON.stringify({ say: "好", title: "太空小方块", hero: "方块", goal: "躲陨石", controls: ["← →"], look: "深蓝" })
          : JSON.stringify({ say: "做好了", files: [{ path: "main.py", content: "import pygame\n\n# 只有一行\n" }] }),
      },
    });
  });
  await signIn(page);

  await page.getByLabel(text.pane.placeholder).fill("做一个太空小方块");
  await page.getByRole("button", { name: text.pane.send }).click();
  await expect(page.getByTestId("candidate")).toBeVisible({ timeout: 30_000 });

  // Reload: a fresh page, the same project. The next round must carry the first
  // one in its conversation, which only works if the session came back from disk.
  await page.reload();
  await expect(page.getByTestId("pane")).toContainText(text.pane.remembers);
  await page.getByLabel(text.pane.placeholder).fill("再改一句");
  await page.locator(".pane-actions .run").click();
  await expect.poll(() => seen.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(3);

  const last = seen.at(-1) ?? [];
  expect(last.some((content) => content.includes("做一个太空小方块"))).toBe(true);
});
