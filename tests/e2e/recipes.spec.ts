import { expect, test, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { createPixels } from "../../src/lib/pixel/buffer";
import { encodePng } from "../../src/lib/pixel/png";
import { text } from "../../src/ui/text";

// 配方、分步挑战、素材提议。不登录就能做。检查看源码和舞台标记，不请模型打分。
// 做成候选不会写作品；丢掉或冲突则项目不变；采用之后可以撤销。

const COIN = "assets/library/forest-adventure/props/coin.png";
const ALLOWED = "kid@example.com";

type StoredFile = { path: string; text?: string; base64?: string };
type StoredProject = { id: string; name: string; files: StoredFile[] };

function watchApi(page: Page) {
  const hits: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/")) hits.push(path);
  });
  return hits;
}

async function storedProjects(page: Page): Promise<StoredProject[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gamekit");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<StoredProject[]>((resolve, reject) => {
      const request = db.transaction("projects").objectStore("projects").getAll();
      request.onsuccess = () => resolve(request.result as StoredProject[]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows;
  });
}

async function projectNamed(page: Page, name: string): Promise<StoredProject | undefined> {
  const rows = await storedProjects(page);
  return rows.find((row) => row.name === name);
}

async function storedFile(page: Page, name: string, path: string): Promise<StoredFile | null> {
  const project = await projectNamed(page, name);
  return project?.files.find((file) => file.path === path) ?? null;
}

async function fileText(page: Page, name: string, path: string): Promise<string | null> {
  return (await storedFile(page, name, path))?.text ?? null;
}

async function openRecipes(page: Page) {
  await page.getByTestId("recipes-open").click();
  await expect(page.getByTestId("recipes-dialog")).toBeVisible();
}

async function signIn(page: Page, email: string) {
  await page.getByRole("button", { name: text.account.signIn, exact: true }).click();
  await page.getByLabel("GitHub 账号邮箱").fill(email);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => url.pathname === "/" && !url.search.includes("login="));
}

test("an anonymous child starts a recipe without covering the old project, and the step is checked from the stage", async ({ page }) => {
  test.setTimeout(180_000);
  const hits = watchApi(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: text.stage.play })).toBeVisible();
  const before = await storedProjects(page);
  expect(before).toHaveLength(1);
  const starter = before[0];
  const starterMain = starter.files.find((file) => file.path === "main.py")?.text ?? "";
  expect(starterMain).toContain("Signal Drift");

  await openRecipes(page);
  await expect(page.getByTestId("recipe-platform")).toBeVisible();
  await expect(page.getByTestId("recipe-catch")).toBeVisible();
  await expect(page.getByTestId("recipe-maze")).toBeVisible();
  await expect(page.getByTestId("recipe-shooter")).toBeVisible();
  await expect(page.getByTestId("recipe-snake")).toBeVisible();
  await expect(page.getByRole("button", { name: text.recipes.write })).toBeVisible();
  await expect(page.getByRole("button", { name: text.recipes.ask })).toBeVisible();
  await page.getByTestId("recipe-new-platform").click();
  await expect(page.getByTestId("recipes-dialog")).toHaveCount(0);
  expect(hits).toEqual([]);

  await expect.poll(async () => (await storedProjects(page)).length).toBe(2);
  const kept = await projectNamed(page, starter.name);
  expect(kept?.id).toBe(starter.id);
  expect(kept?.files.find((file) => file.path === "main.py")?.text).toBe(starterMain);
  const recipe = await projectNamed(page, "平台跳跃");
  expect(recipe?.id).not.toBe(starter.id);
  expect(recipe?.files.find((file) => file.path === "main.py")?.text).toContain("JUMP = -9");
  expect(recipe?.files.find((file) => file.path === "assets/hero.png")?.base64).toBeTruthy();
  expect(recipe?.files.find((file) => file.path === "README.txt")?.text).toContain("重力");

  await page.getByRole("button", { name: text.stage.play }).click();
  await page.getByRole("tab", { name: text.header.code }).click();
  await expect(page.locator(".console")).toContainText("RECIPE-OK platform", { timeout: 120_000 });
  await expect(page.locator(".console")).toContainText("RECIPE-JUMP -9");
  await expect(page.getByTestId("console-kid-error")).toHaveCount(0);

  await openRecipes(page);
  await page.getByTestId("recipe-resume-platform").click();
  await expect(page.getByTestId("challenge-dialog")).toBeVisible();
  await expect(page.getByTestId("challenge-goal")).toContainText("JUMP");
  await page.getByTestId("challenge-hint").click();
  await expect(page.getByTestId("challenge-hint-text")).toContainText("JUMP = -9");
  await page.getByTestId("challenge-explain").click();
  await expect(page.getByTestId("challenge-explain-text")).toContainText("负数");
  await page.getByTestId("challenge-check").click();
  await expect(page.getByTestId("challenge-result")).toHaveAttribute("data-ok", "false");

  await page.getByTestId("challenge-candidate").click();
  await expect(page.getByTestId("candidate")).toBeVisible();
  await expect.poll(async () => fileText(page, "平台跳跃", "main.py")).toContain("JUMP = -9");
  await page.getByTestId("discard").click();
  await expect(page.getByTestId("design-turn")).toContainText(text.pane.discarded);
  expect(await fileText(page, "平台跳跃", "main.py")).toContain("JUMP = -9");

  await openRecipes(page);
  await page.getByTestId("recipe-resume-platform").click();
  await page.getByTestId("challenge-candidate").click();
  await page.getByTestId("adopt").click();
  await expect(page.getByTestId("design-turn").last()).toContainText(text.pane.adopted);
  await expect.poll(async () => fileText(page, "平台跳跃", "main.py")).toContain("JUMP = -13");

  await openRecipes(page);
  await page.getByTestId("recipe-resume-platform").click();
  await page.getByTestId("challenge-check").click();
  await expect(page.getByTestId("challenge-result")).toHaveAttribute("data-ok", "false");
  await expect(page.getByTestId("challenge-result")).toContainText("对不上");
  await page.getByTestId("challenge-dialog").getByRole("button", { name: text.recipes.close }).click();

  await page.getByRole("button", { name: text.stage.play }).click();
  await expect(page.locator(".console")).toContainText("RECIPE-JUMP -13", { timeout: 120_000 });
  await openRecipes(page);
  await page.getByTestId("recipe-resume-platform").click();
  await page.getByTestId("challenge-check").click();
  await expect(page.getByTestId("challenge-result")).toHaveAttribute("data-ok", "true");
  await page.getByTestId("challenge-dialog").getByRole("button", { name: text.recipes.close }).click();

  await page.getByRole("button", { name: text.header.undoShort, exact: true }).click();
  await expect.poll(async () => fileText(page, "平台跳跃", "main.py")).toContain("JUMP = -9");
  expect(await fileText(page, starter.name, "main.py")).toBe(starterMain);
  await openRecipes(page);
  await page.getByTestId("recipe-resume-platform").click();
  await page.getByTestId("challenge-check").click();
  await expect(page.getByTestId("challenge-result")).toHaveAttribute("data-ok", "false");
  expect(hits).toEqual([]);
});

test("proposing a catalog picture stays a candidate, and a different file is not replaced", async ({ page }) => {
  const hits = watchApi(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: text.stage.play })).toBeVisible();

  await page.getByTestId("library-open").click();
  await page.getByTestId("library-search").fill("金币");
  await page.getByTestId("library-asset-coin").click();
  await page.getByTestId("library-propose").click();
  await expect(page.getByTestId("candidate")).toBeVisible();
  await expect(page.getByTestId("design-turn")).toContainText("coin.png");
  expect(await storedFile(page, "my-cool-game", COIN)).toBeNull();
  expect(hits.some((path) => path.startsWith("/api/"))).toBe(false);

  await page.getByTestId("discard").click();
  await expect(page.getByTestId("design-turn")).toContainText(text.pane.discarded);
  expect(await storedFile(page, "my-cool-game", COIN)).toBeNull();

  await page.getByTestId("library-open").click();
  await page.getByTestId("library-search").fill("金币");
  await page.getByTestId("library-asset-coin").click();
  await page.getByTestId("library-propose").click();
  await page.getByTestId("adopt").click();
  await expect.poll(async () => (await storedFile(page, "my-cool-game", COIN))?.base64 ?? null).not.toBeNull();
  expect(await fileText(page, "my-cool-game", "examples/load-coin.py")).toContain("pygame.image.load");

  await page.getByRole("button", { name: text.header.undoShort, exact: true }).click();
  await expect.poll(async () => storedFile(page, "my-cool-game", COIN)).toBeNull();

  const old = encodePng(createPixels(2, 2, [200, 40, 40, 255]));
  const archive = Buffer.from(zipSync({ "main.py": strToU8("print('keep')\n"), [COIN]: old }));
  await page.getByRole("button", { name: text.header.project, exact: true }).click();
  await page.getByTestId("projects-panel").locator('input[type="file"]').setInputFiles({
    name: "clash.zip",
    mimeType: "application/zip",
    buffer: archive,
  });
  await expect(page.getByTestId("projects-panel")).toHaveCount(0);

  await page.getByTestId("library-open").click();
  await page.getByTestId("library-search").fill("金币");
  await page.getByTestId("library-asset-coin").click();
  await page.getByTestId("library-propose").click();
  await expect(page.getByTestId("notice")).toContainText("没有盖掉");
  await expect(page.getByTestId("candidate")).toHaveCount(0);
  const clash = (await storedProjects(page)).find((row) => row.files.some((file) => file.path === COIN && file.base64));
  expect(clash?.files.find((file) => file.path === COIN)?.base64).toBe(Buffer.from(old).toString("base64"));
});

test("an allowed account proposes a picture without writing the project first", async ({ page }) => {
  const hits: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/ai")) hits.push(path);
  });
  await page.goto("/");
  await signIn(page, ALLOWED);
  await expect(page.locator(".account")).toContainText("kid");

  await page.getByTestId("library-open").click();
  await page.getByTestId("library-asset-hero").click();
  await page.getByTestId("library-propose").click();
  await expect(page.getByTestId("candidate")).toBeVisible();
  expect(await storedFile(page, "my-cool-game", "assets/library/forest-adventure/characters/hero.png")).toBeNull();
  expect(hits).toEqual([]);
  await page.getByTestId("discard").click();
  expect(await storedFile(page, "my-cool-game", "assets/library/forest-adventure/characters/hero.png")).toBeNull();
});

test("a signed-in child who is not allowed can still start a recipe, and a tokenless search is refused", async ({ page }) => {
  await page.goto("/");
  await signIn(page, "stranger@example.com");
  await expect(page.getByTestId("notice")).toContainText(text.account.notes.denied);
  await page.getByTestId("notice").click();

  const before = await storedProjects(page);
  await openRecipes(page);
  await page.getByTestId("recipe-new-catch").click();
  await expect.poll(async () => (await storedProjects(page)).length).toBe(before.length + 1);
  const recipe = await projectNamed(page, "接球");
  expect(recipe?.files.find((file) => file.path === "main.py")?.text).toContain("PADDLE = 6");
  const starter = before[0];
  const kept = await projectNamed(page, starter.name);
  expect(kept?.files.find((file) => file.path === "main.py")?.text).toBe(
    starter.files.find((file) => file.path === "main.py")?.text,
  );

  const ai = await page.request.post("/api/ai", {
    data: { op: "complete", messages: [{ role: "user", content: "hi" }] },
  });
  expect(ai.status()).toBe(403);
  const mcp = await page.request.post("/mcp", {
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "search_assets", arguments: { query: "金币" } },
    },
  });
  expect(mcp.status()).toBe(401);
});

test("a blocking sleep is explained for the child and the original line stays", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: text.header.code }).click();
  await page.locator(".monaco-editor").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\ntime.sleep(1)\n");
  await page.locator(".bottom-tabs").getByRole("button", { name: /问题/ }).click();
  await expect(page.locator(".problems")).toContainText("卡住");
  await page.locator(".problems").getByText(text.codeExtra.technical).click();
  await expect(page.locator(".problems")).toContainText("time.sleep");
});
