import { expect, test, type Page } from "@playwright/test";
import { text } from "../../src/ui/text";

// 弹层里的按钮：「保存到项目」「新建项目」是主按钮，要有底色；「生成」「✕」要有边框。
// 回归：`.modal button` 的重置曾经压过 `.run` / `.ghost`，主按钮变成浅色字落在浅色底上，看不见。

const PINE = "rgb(29, 102, 70)";
const LINE_STRONG = "rgb(185, 178, 165)";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: text.account.signIn, exact: true }).click();
  await page.getByLabel("GitHub 账号邮箱").fill("kid@example.com");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => url.pathname === "/" && !url.search.includes("login="));
}

test("the projects panel keeps its primary button visible and its close button outlined", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: text.header.project, exact: true }).click();
  const panel = page.getByTestId("projects-panel");
  await expect(panel).toBeVisible();

  await expect(panel.getByRole("button", { name: new RegExp(text.project.newProject) })).toHaveCSS("background-color", PINE);
  await expect(panel.getByTestId("projects-close")).toHaveCSS("border-top-color", LINE_STRONG);
});

test("the picture dialog keeps 保存到项目 coloured, also before there is a picture to save", async ({ page }) => {
  await signIn(page);
  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.code.assets, exact: true }).click();
  await page.getByRole("button", { name: text.code.generate }).click();

  const dialog = page.getByTestId("asset-dialog");
  const save = dialog.getByRole("button", { name: text.assets.accept });
  await expect(save).toBeDisabled();
  await expect(save).toHaveCSS("background-color", PINE);
  await expect(dialog.getByRole("button", { name: text.assets.generate })).toHaveCSS("border-top-color", LINE_STRONG);
});

test("the sound dialog keeps 保存到项目 coloured", async ({ page }) => {
  await signIn(page);
  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.code.assets, exact: true }).click();
  await page.getByTestId("sound-open").click();

  const dialog = page.getByTestId("sound-dialog");
  await expect(dialog.getByRole("button", { name: text.sounds.accept })).toHaveCSS("background-color", PINE);
  await expect(dialog.getByRole("button", { name: text.sounds.generate })).toHaveCSS("border-top-color", LINE_STRONG);
});

test("the pixel dialogs keep 开始画 and 保存 coloured", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.code.assets, exact: true }).click();
  await page.getByTestId("pixel-new").click();
  await expect(page.getByTestId("pixel-start")).toHaveCSS("background-color", PINE);
  await page.getByTestId("pixel-start").click();
  await expect(page.getByTestId("pixel-save")).toHaveCSS("background-color", PINE);
});
