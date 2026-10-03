import { expect, test, type Page } from "@playwright/test";
import { text } from "../../src/ui/text";

// Pictures in the ask box: pasted, picked or dropped. The model call is stubbed at
// the network boundary, but the request body is captured, so this asserts what the
// page really sends: a text part plus an image part, downscaled in the browser.

/** A red 64×64 PNG, made in the page so no fixture file is needed. */
async function pngBase64(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    context.fillStyle = "#cc2222";
    context.fillRect(0, 0, 64, 64);
    return canvas.toDataURL("image/png").split(",")[1];
  });
}

type Capture = { text: string | null; images: number; dataUrlPrefixes: string[] };

async function captureModelCalls(page: Page): Promise<Capture[]> {
  const captured: Capture[] = [];
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postData() ?? "";
    const parsed = JSON.parse(body) as { op?: string; messages?: { role: string; content: unknown }[] };
    if (parsed.op !== "complete") {
      await route.fallback();
      return;
    }
    const user = parsed.messages?.find((message) => message.role === "user");
    const parts = Array.isArray(user?.content) ? (user?.content as { type: string; text?: string; image_url?: { url: string } }[]) : [];
    captured.push({
      text: parts.length ? parts.find((part) => part.type === "text")?.text ?? null : String(user?.content ?? ""),
      images: parts.filter((part) => part.type === "image_url").length,
      dataUrlPrefixes: parts.filter((part) => part.type === "image_url").map((part) => (part.image_url?.url ?? "").slice(0, 24)),
    });
    await route.fulfill({
      json: { text: parsedDesign(parts) },
    });
  });
  return captured;
}

/** The design step gets the pictures; the build step only needs files. */
function parsedDesign(parts: { type: string; text?: string }[]): string {
  const text = parts.find((part) => part.type === "text")?.text ?? "";
  if (text.includes('"hero"')) {
    return JSON.stringify({
      say: "我看到了，先这样设计。",
      title: "红色小方块",
      hero: "一个小方块",
      goal: "看图做一个游戏",
      controls: ["← →"],
      look: "红色",
    });
  }
  return JSON.stringify({
    say: "做好了。",
    files: [
      {
        path: "main.py",
        content:
          'import asyncio\nimport pygame\n\npygame.init()\nscreen = pygame.display.set_mode((320, 240))\nclock = pygame.time.Clock()\n\n\nasync def main():\n    running = True\n    while running:\n        for event in pygame.event.get():\n            if event.type == pygame.QUIT:\n                running = False\n        screen.fill((200, 40, 40))\n        pygame.display.flip()\n        clock.tick(60)\n        await asyncio.sleep(0)\n\n\nasyncio.run(main())\n',
      },
    ],
  });
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: text.account.signIn, exact: true }).click();
  await page.getByLabel("GitHub 账号邮箱").fill("kid@example.com");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => url.pathname === "/" && !url.search.includes("login="));
}

async function attach(page: Page, base64: string, name = "shot.png") {
  await page.getByTestId("image-input").setInputFiles({
    name,
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
}

test("a picked picture is attached, sent with the round, and shown in the turn", async ({ page }) => {
  const calls = await captureModelCalls(page);
  await signIn(page);
  const base64 = await pngBase64(page);
  await attach(page, base64);

  const attachments = page.getByTestId("attachments");
  await expect(attachments.locator("img")).toHaveCount(1);
  await expect(page.getByLabel(text.pane.placeholder)).toHaveValue("");

  // Sending with no words still asks something sensible; the picture is the point.
  await page.getByRole("button", { name: text.pane.send }).click();
  await expect(page.getByTestId("design-turn")).toContainText(text.pane.imageOnly);
  await expect(page.getByTestId("design-turn").locator(".said-images img")).toHaveCount(1);
  await expect(attachments).toHaveCount(0);

  // The round makes two calls: the design step (with the picture) and the build.
  await expect.poll(() => calls.length, { timeout: 15_000 }).toBe(2);
  expect(calls[0].images).toBe(1);
  expect(calls[0].dataUrlPrefixes[0]).toContain("data:image/jpeg;base64,");
  expect(calls[0].text).toContain(text.pane.imageOnly);
  expect(calls[0].text).toContain("1 张图片");
  // The build step works from the design card, so it carries no pictures.
  expect(calls[1].images).toBe(0);
});

test("a pasted picture shows up as a thumbnail and can be taken off again", async ({ page }) => {
  await signIn(page);
  const base64 = await pngBase64(page);

  await page.getByLabel(text.pane.placeholder).click();
  await page.evaluate(async (data) => {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const file = new File([bytes], "pasted.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const target = document.querySelector('[data-testid="ask"] textarea') as HTMLTextAreaElement;
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, base64);

  const attachments = page.getByTestId("attachments");
  await expect(attachments.locator("img")).toHaveCount(1);
  await attachments.getByRole("button", { name: text.pane.removeImage }).click();
  await expect(attachments).toHaveCount(0);
  await expect(page.getByRole("button", { name: text.pane.send })).toBeDisabled();
});

test("a picture never becomes a project file on its own", async ({ page }) => {
  await signIn(page);
  await attach(page, await pngBase64(page));
  await page.getByLabel(text.pane.placeholder).fill("照这个做一个游戏");
  await page.getByRole("button", { name: text.pane.send }).click();
  await expect(page.getByTestId("design-turn")).toBeVisible();

  await page.getByRole("tab", { name: text.header.code }).click();
  await page.getByRole("button", { name: text.code.files, exact: true }).click();
  await expect(page.locator(".tree")).not.toContainText("shot.png");
});
