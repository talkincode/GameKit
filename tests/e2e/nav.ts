import { expect, type Page } from "@playwright/test";
import { text } from "../../src/ui/text";

/** Project name opens the menu; 「我的项目」opens the panel. */
export async function openProjectMenu(page: Page) {
  const panel = page.getByTestId("project-menu-panel");
  if (!(await panel.isVisible())) await page.getByTestId("project-menu").click();
  await expect(panel).toBeVisible();
}

export async function openProjectsPanel(page: Page) {
  const projects = page.getByTestId("projects-panel");
  // A preview that starts mid-click closes the menu (setMenu(null)). Retry until the panel is up.
  await expect(async () => {
    if (await projects.isVisible()) return;
    const menu = page.getByTestId("project-menu-panel");
    if (!(await menu.isVisible())) {
      await page.getByTestId("project-menu").click();
      await expect(menu).toBeVisible({ timeout: 1_000 });
    }
    await page.getByTestId("projects-open").click({ timeout: 1_000 });
    await expect(projects).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

export async function openRecipes(page: Page) {
  await openProjectMenu(page);
  await page.getByTestId("recipes-open").click();
}

/** 日志 and 设置 live in 「更多」. */
export async function openMoreMenu(page: Page) {
  const panel = page.getByTestId("more-menu-panel");
  if (!(await panel.isVisible())) await page.getByTestId("more-open").click();
  await expect(panel).toBeVisible();
}

export async function openLogs(page: Page) {
  await openMoreMenu(page);
  await page.getByTestId("logs-open").click();
}

export async function openSettings(page: Page) {
  await openMoreMenu(page);
  await page.getByTestId("settings-open").click();
}

/** Signed-in name and 退出 share one account menu. */
export async function signOut(page: Page) {
  await page.getByTestId("account-menu").click();
  await page.getByRole("button", { name: text.account.signOut, exact: true }).click();
}
