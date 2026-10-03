import { expect, test } from "@playwright/test";
import { text } from "../../src/ui/text";

// 看代码 的版面：三块面板各自可以收拢，右侧「撤销」是图标加一个字。

test("the code view panels collapse, and the choice sticks", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: text.header.code }).click();
  const sidebar = page.locator(".sidebar");
  const stage = page.locator(".stage-pane");
  const bottom = page.locator(".bottom");
  await expect(sidebar).toBeVisible();
  await expect(stage).toBeVisible();
  await expect(bottom).toBeVisible();

  const toggle = (panel: "side" | "stage" | "bottom") => page.getByTestId(`panel-${panel}`);
  await toggle("side").click();
  await expect(sidebar).toHaveCount(0);
  // The editor takes the space the sidebar gave up.
  const editor = await page.locator(".editor").boundingBox();
  expect((editor?.width ?? 0) > 900).toBe(true);

  await toggle("bottom").click();
  await expect(bottom).toHaveCount(0);
  // The stage is never unmounted — a running game has to survive collapsing —
  // so it collapses to zero width instead of disappearing from the DOM.
  await toggle("stage").click();
  await expect(stage).toBeHidden();

  // The layout is a preference: it survives a reload.
  await page.reload();
  await page.getByRole("tab", { name: text.header.code }).click();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.locator(".stage-pane")).toBeHidden();
  await expect(page.locator(".bottom")).toHaveCount(0);
  await expect(page.getByTestId("panel-side")).toHaveAttribute("aria-pressed", "false");

  await toggle("side").click();
  await expect(page.locator(".sidebar")).toBeVisible();
});

test("undo is an icon with a word, and says what it does", async ({ page }) => {
  await page.goto("/");
  const undo = page.getByRole("button", { name: text.header.undoShort });
  await expect(undo).toBeVisible();
  await expect(undo).toHaveAttribute("title", text.header.undo);
  await expect(undo).toBeDisabled();
});
