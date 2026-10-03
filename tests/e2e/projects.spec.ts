import { expect, test, type Page } from "@playwright/test";
import { text } from "../../src/ui/text";

// 我的项目：a panel of its own. Search, open, rename, duplicate, export, delete —
// all through the studio's actions, and a delete always asks first.

async function openProjects(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: text.header.project, exact: true }).click();
  await expect(page.getByTestId("projects-panel")).toBeVisible();
}

/** 新建/复制/删除 change the open project, and that closes the panel. */
async function reopen(page: Page) {
  await page.getByRole("button", { name: text.header.project, exact: true }).click();
  await expect(page.getByTestId("projects-panel")).toBeVisible();
}

test("the panel lists projects, searches them, and opens one", async ({ page }) => {
  await openProjects(page);
  const panel = page.getByTestId("projects-panel");
  await expect(panel.locator(".project-card")).toHaveCount(1);
  await expect(panel.locator(".project-name em")).toHaveText(text.project.current);
  await expect(panel.locator(".projects-foot")).toContainText(text.project.local);

  // Create a second project from the panel, then find it by name.
  page.once("dialog", (dialog) => void dialog.accept("太空小方块"));
  await panel.getByRole("button", { name: new RegExp(text.project.newProject) }).click();
  await expect(panel).toHaveCount(0);
  await reopen(page);
  await expect(panel.locator(".project-card")).toHaveCount(2);
  await expect(panel.locator(".project-name em")).toContainText(text.project.current);

  await panel.getByLabel(text.project.search).fill("太空");
  await expect(panel.locator(".project-card")).toHaveCount(1);
  await expect(panel.locator(".project-card")).toContainText("太空小方块");
  await panel.getByLabel(text.project.search).fill("不存在的名字");
  await expect(panel).toContainText(text.project.searchEmpty);

  await panel.getByLabel(text.project.search).fill("");
  // The open control is the card itself, so its name is the project's own text.
  await panel.locator(".project-card", { hasText: "my-cool-game" }).locator(".project-open").click();
  await expect(panel).toHaveCount(0);
});

test("renaming and deleting happen in the card, and deleting asks first", async ({ page }) => {
  await openProjects(page);
  const panel = page.getByTestId("projects-panel");
  const card = panel.locator(".project-card").first();

  await card.getByRole("button", { name: text.project.rename }).click();
  await card.getByRole("textbox").fill("狐狸追星星");
  await card.getByRole("button", { name: text.project.rename, exact: true }).click();
  await expect(panel.locator(".project-name")).toContainText("狐狸追星星");

  await card.getByRole("button", { name: text.project.delete }).click();
  const confirm = panel.getByTestId("project-delete-confirm");
  await expect(confirm).toContainText(text.project.confirmDelete("狐狸追星星"));
  await confirm.getByRole("button", { name: text.project.cancel }).click();
  await expect(panel.locator(".project-card")).toHaveCount(1);

  await card.getByRole("button", { name: text.project.delete }).click();
  await panel.getByTestId("project-delete-confirm").getByRole("button", { name: text.project.deleteConfirm }).click();
  // Deleting the last project leaves a fresh one behind, so the studio is never empty.
  await expect(panel).toHaveCount(0);
  await reopen(page);
  await expect(panel.locator(".project-card")).toHaveCount(1);
  await expect(panel.locator(".project-name")).not.toContainText("狐狸追星星");
});

test("a project that is not open cannot be changed from the panel", async ({ page }) => {
  await openProjects(page);
  const panel = page.getByTestId("projects-panel");
  page.once("dialog", (dialog) => void dialog.accept("第二个项目"));
  await panel.getByRole("button", { name: new RegExp(text.project.newProject) }).click();
  await reopen(page);
  await expect(panel.locator(".project-card")).toHaveCount(2);

  const other = panel.locator(".project-card", { hasText: "my-cool-game" });
  await expect(other.getByRole("button", { name: text.project.delete })).toBeDisabled();
  await expect(other.getByRole("button", { name: text.project.delete })).toHaveAttribute("title", text.project.openFirst);
  await expect(other.locator(".project-open")).toBeEnabled();
});
