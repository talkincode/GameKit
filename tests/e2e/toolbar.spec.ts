import { expect, test, type Page } from "@playwright/test";
import { text } from "../../src/ui/text";

// 顶栏一行：窄屏把次要按钮收进「更多」，不换行，功能都还在。

const PINE = "rgb(29, 102, 70)";

function tierOf(width: number) {
  if (width >= 1100) return "wide";
  if (width >= 800) return "medium";
  return "narrow";
}

async function expectOneLine(page: Page, width: number) {
  const toolbar = page.getByTestId("toolbar");
  await expect(toolbar).toHaveAttribute("data-tier", tierOf(width));
  await expect.poll(async () => toolbar.evaluate((el) => {
    const bar = el.getBoundingClientRect();
    if (bar.height > 60) return `height ${bar.height}`;
    if (el.scrollWidth > el.clientWidth + 1) return `scroll ${el.scrollWidth} > ${el.clientWidth}`;
    const nodes = [...el.querySelectorAll("button, [role=tab]")].filter((node) => {
      if (node.closest(".menu")) return false;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const rects = nodes.map((node) => ({ name: (node.getAttribute("aria-label") || node.textContent || "").trim(), box: node.getBoundingClientRect() }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].box;
        const b = rects[j].box;
        const overlap = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        if (overlap) return `overlap ${rects[i].name} / ${rects[j].name}`;
      }
    }
    return "";
  }), { message: `toolbar at ${width}px` }).toBe("");
}

test("the toolbar stays one line at 1280, 1024, and 768, and every action is reachable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("stage")).toBeVisible();

  for (const width of [1280, 1024, 768]) {
    await page.setViewportSize({ width, height: 860 });
    await page.keyboard.press("Escape");
    const tier = tierOf(width);

    await expectOneLine(page, width);
    if (width >= 1100) await expect(page.locator(".brand-tagline")).toBeVisible();
    else await expect(page.locator(".brand-tagline")).toBeHidden();

    await expect(page.getByRole("tab", { name: text.header.design })).toBeVisible();
    await expect(page.getByRole("tab", { name: text.header.code })).toBeVisible();
    await expect(page.getByRole("button", { name: text.account.signIn, exact: true })).toBeVisible();
    const exportButton = page.getByTestId("export-open");
    await expect(exportButton).toBeVisible();
    await expect(exportButton).toHaveCSS("background-color", PINE);

    if (tier === "wide") {
      await expect(page.getByTestId("library-open")).toBeVisible();
      await expect(page.getByTestId("undo")).toBeVisible();
    } else if (tier === "medium") {
      await expect(page.getByTestId("undo")).toBeVisible();
      await expect(page.getByTestId("library-open")).toHaveCount(0);
    } else {
      await expect(page.getByTestId("undo")).toHaveCount(0);
      await expect(page.getByTestId("library-open")).toHaveCount(0);
    }

    await expect(page.getByTestId("save-state")).toBeVisible();
    await expect(page.getByTestId("toolbar").getByTestId("panel-side")).toHaveCount(0);

    await page.getByTestId("project-menu").click();
    await expect(page.getByRole("button", { name: text.header.newProject, exact: true })).toBeVisible();
    await expect(page.getByTestId("projects-open")).toBeVisible();
    await expect(page.getByTestId("recipes-open")).toBeVisible();
    await expect(page.getByTestId("project-import")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByTestId("more-open").click();
    if (tier !== "wide") await expect(page.getByTestId("library-open")).toBeVisible();
    if (tier === "narrow") await expect(page.getByTestId("undo")).toBeVisible();
    await expect(page.getByTestId("logs-open")).toBeVisible();
    await expect(page.getByTestId("settings-open")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByTestId("export-open").click();
    await expect(page.getByRole("button", { name: text.export.web })).toBeVisible();
    await expect(page.getByTestId("export-offline-note")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("export-menu")).toHaveCount(0);

    await page.getByRole("tab", { name: text.header.code }).click();
    await expectOneLine(page, width);
    await expect(page.getByTestId("toolbar").getByTestId("panel-side")).toHaveCount(0);
    await expect(page.getByTestId("panel-side")).toBeVisible();
    await expect(page.getByTestId("panel-stage")).toBeVisible();
    await expect(page.getByTestId("panel-bottom")).toBeVisible();
    await page.getByRole("tab", { name: text.header.design }).click();
    await expect(page.getByTestId("panel-side")).toBeHidden();
  }
});
