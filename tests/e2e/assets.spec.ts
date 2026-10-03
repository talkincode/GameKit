import { expect, test, type Page } from "@playwright/test";
import { text } from "../../src/ui/text";

// 素材生成 end to end: the model call is stubbed at the network boundary (Gemini
// is remote-only, so there is no image model in CI), but everything the page does
// with the answer is the real code path: decode → cut background → trim → resize
// → preview → 放进项目.

test.setTimeout(120_000);

/** A 64×64 white picture with a red bar in it: the flat background is removable. */
async function stubPicture(page: Page): Promise<void> {
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postData() ?? "";
    if (!body.includes('"op":"image"')) {
      await route.fallback();
      return;
    }
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext("2d") as CanvasRenderingContext2D;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 64, 64);
      context.fillStyle = "#cc2222";
      context.fillRect(16, 26, 32, 12);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await route.fulfill({ json: { image: png, mediaType: "image/png" } });
  });
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: text.account.signIn, exact: true }).click();
  await page.getByLabel("GitHub 账号邮箱").fill("kid@example.com");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => url.pathname === "/" && !url.search.includes("login="));
}

test("a generated picture becomes a small transparent PNG in assets/", async ({ page }) => {
  await stubPicture(page);
  await signIn(page);
  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.code.assets, exact: true }).click();
  await page.getByRole("button", { name: text.code.generate }).click();

  const dialog = page.getByTestId("asset-dialog");
  await dialog.getByRole("textbox").fill("小狐狸");
  await dialog.getByRole("button", { name: text.assets.generate }).click();

  // The preview is the file that will be stored, not the raw model output.
  const preview = dialog.locator("img.generated");
  await expect(preview).toBeVisible({ timeout: 60_000 });
  await expect(dialog).toContainText(text.assets.pixel(48, 48));

  const pixels = await preview.evaluate(async (node: HTMLImageElement) => {
    const bitmap = await createImageBitmap(await fetch(node.src).then((response) => response.blob()));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    context.drawImage(bitmap, 0, 0);
    const at = (x: number, y: number) => context.getImageData(x, y, 1, 1).data[3];
    return { width: bitmap.width, height: bitmap.height, corner: at(2, 2), middle: at(24, 24) };
  });
  expect(pixels).toEqual({ width: 48, height: 48, corner: 0, middle: 255 });

  await dialog.getByRole("button", { name: text.assets.accept }).click();
  // It lands in assets/ and shows up in the 素材 pane we are looking at.
  const stored = page.locator(".asset-grid .card", { hasText: /sprite-\d+\.png/ });
  await expect(stored).toHaveCount(1);
  await page.getByRole("button", { name: text.code.files, exact: true }).click();
  await expect(page.locator(".tree")).toContainText(/sprite-\d+\.png/);

  await page.getByRole("button", { name: text.header.undo }).click();
  await page.getByRole("button", { name: text.code.assets, exact: true }).click();
  await expect(stored).toHaveCount(0);
});

test("the size choice changes what lands in assets/, and 去掉背景 can be turned off", async ({ page }) => {
  await stubPicture(page);
  await signIn(page);
  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.code.assets, exact: true }).click();
  await page.getByRole("button", { name: text.code.generate }).click();

  const dialog = page.getByTestId("asset-dialog");
  await dialog.getByRole("button", { name: text.assets.sizeValue(64) }).click();
  await dialog.getByRole("checkbox", { name: new RegExp(text.assets.cut) }).uncheck();
  await dialog.getByRole("textbox").fill("小狐狸");
  await dialog.getByRole("button", { name: text.assets.generate }).click();

  await expect(dialog).toContainText(text.assets.pixel(64, 64), { timeout: 60_000 });
  // Background kept: the white picture stays white all the way to the edges.
  const corner = await dialog.locator("img.generated").evaluate(async (node: HTMLImageElement) => {
    const bitmap = await createImageBitmap(await fetch(node.src).then((response) => response.blob()));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    context.drawImage(bitmap, 0, 0);
    const [r, g, b, a] = context.getImageData(2, 2, 1, 1).data;
    return { r, g, b, a };
  });
  expect(corner).toEqual({ r: 255, g: 255, b: 255, a: 255 });
});

test("closing the maker keeps the picture until it is saved", async ({ page }) => {
  await stubPicture(page);
  await signIn(page);
  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.code.assets, exact: true }).click();
  await page.getByRole("button", { name: text.code.generate }).click();

  const dialog = page.getByTestId("asset-dialog");
  await dialog.getByRole("textbox").fill("小狐狸");
  await dialog.getByRole("button", { name: text.assets.generate }).click();
  await expect(dialog.locator("img.generated")).toBeVisible({ timeout: 60_000 });
  await expect(dialog).toContainText(text.assets.keepHint);

  // Nothing is saved yet: closing must not throw the picture away.
  await dialog.getByRole("button", { name: text.assets.close }).click();
  await expect(page.getByTestId("asset-dialog")).toHaveCount(0);
  await expect(page.locator(".asset-grid .card")).toHaveCount(2);

  await page.getByRole("button", { name: text.code.generate }).click();
  const reopened = page.getByTestId("asset-dialog");
  await expect(reopened.locator("img.generated")).toBeVisible();
  await reopened.getByRole("button", { name: text.assets.accept }).click();
  const stored = page.locator(".asset-grid .card", { hasText: /sprite-\d+\.png/ });
  await expect(stored).toHaveCount(1);
});

test("an anonymous child cannot start the asset maker", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByTestId("stage")).toBeVisible();
  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.code.assets, exact: true }).click();
  await page.getByRole("button", { name: text.code.generate }).click();
  await page.getByTestId("asset-dialog").getByRole("textbox").fill("小狐狸");
  await page.getByTestId("asset-dialog").getByRole("button", { name: text.assets.generate }).click();
  await expect(page.getByTestId("asset-dialog")).toHaveCount(0);
  await expect(page.locator(".notice")).toContainText(text.ai.needsSignIn);
  expect(apiCalls).toEqual([]);
});
