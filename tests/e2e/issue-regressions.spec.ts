import { expect, test, type Page } from "@playwright/test";
import { text } from "../../src/ui/text";

async function openCode(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: text.header.code }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
}

async function createSecondProject(page: Page, name: string) {
  await page.getByRole("button", { name: text.header.project, exact: true }).click();
  page.once("dialog", (dialog) => void dialog.accept(name));
  await page.getByTestId("projects-panel").getByRole("button", { name: new RegExp(text.project.newProject) }).click();
}

test("undo history is cleared when opening a different project", async ({ page }) => {
  await openCode(page);
  await page.getByRole("button", { name: `${text.code.delete} main.py` }).click();
  await page.getByTestId("delete-confirm").getByRole("button", { name: text.code.trashConfirm }).click();
  const undo = page.getByRole("button", { name: text.header.undoShort });
  await expect(undo).toBeEnabled();

  await createSecondProject(page, "second-project");
  await expect(undo).toBeDisabled();
  await expect(page.locator(".tree")).toContainText("main.py");
});

test("switching projects flushes the pending text save", async ({ page }) => {
  await openCode(page);
  await createSecondProject(page, "second-project");
  await page.getByRole("button", { name: text.header.project, exact: true }).click();
  await page.getByTestId("projects-panel").locator(".project-card", { hasText: "my-cool-game" }).locator(".project-open").click();
  await page.getByRole("tab", { name: text.header.code }).click();
  const projectId = await page.evaluate(() => localStorage.getItem("gamekit.active"));

  // Hold the 350 ms debounce. A project switch must explicitly flush this write.
  await page.evaluate(() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout === 350 && typeof handler === "function") return nativeSetTimeout(handler, 60_000, ...args);
      return nativeSetTimeout(handler, timeout, ...args);
    }) as typeof window.setTimeout;
  });
  const editor = page.locator(".monaco-editor .view-lines");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("# flush-on-project-switch");
  await expect(editor).toContainText("flush-on-project-switch");
  await page.waitForTimeout(50);
  await page.getByRole("button", { name: text.header.project, exact: true }).click();
  await page.getByTestId("projects-panel").locator(".project-card", { hasText: "second-project" }).locator(".project-open").click();

  const saved = await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gamekit");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const row = await new Promise<{ files: { path: string; text?: string }[] } | undefined>((resolve, reject) => {
      const request = db.transaction("projects").objectStore("projects").get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return row?.files.find((file) => file.path === "main.py")?.text ?? "";
  }, projectId);
  expect(saved).toContain("flush-on-project-switch");
});

test("batch asset uploads keep every selected file", async ({ page }) => {
  await openCode(page);
  await page.getByRole("button", { name: text.code.assets, exact: true }).click();
  await page.locator('input[type="file"][multiple]').setInputFiles([
    { name: "first.bin", mimeType: "application/octet-stream", buffer: Buffer.from([1, 2, 3]) },
    { name: "second.bin", mimeType: "application/octet-stream", buffer: Buffer.from([4, 5, 6]) },
  ]);
  await expect(page.getByRole("button", { name: "assets/first.bin", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "assets/second.bin", exact: true })).toBeVisible();
});

test("preview startup cancelled by Stop cannot reopen the frame", async ({ page }) => {
  await page.addInitScript(() => {
    const container = ServiceWorkerContainer.prototype;
    const register = container.register;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.assign(window, { __releaseServiceWorker: release, __serviceWorkerStarted: false });
    container.register = function (scriptURL, options) {
      Object.assign(window, { __serviceWorkerStarted: true });
      return gate.then(() => register.call(this, scriptURL, options));
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: text.stage.play }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __serviceWorkerStarted?: boolean }).__serviceWorkerStarted)).toBe(true);
  await page.getByRole("button", { name: text.stage.stop }).click();
  await page.evaluate(() => (window as unknown as { __releaseServiceWorker: () => void }).__releaseServiceWorker());
  await expect(page.locator(`iframe[title="${text.brand.name}"]`)).toHaveAttribute("src", "about:blank");
});

test("switching projects cancels a pending preview startup", async ({ page }) => {
  await page.addInitScript(() => {
    const container = ServiceWorkerContainer.prototype;
    const register = container.register;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.assign(window, { __releaseServiceWorker: release, __serviceWorkerStarted: false });
    container.register = function (scriptURL, options) {
      Object.assign(window, { __serviceWorkerStarted: true });
      return gate.then(() => register.call(this, scriptURL, options));
    };
  });
  await openCode(page);
  await createSecondProject(page, "second-project");
  await page.getByRole("button", { name: text.stage.play }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __serviceWorkerStarted?: boolean }).__serviceWorkerStarted)).toBe(true);
  await page.getByRole("button", { name: text.header.project, exact: true }).click();
  await page.getByTestId("projects-panel").locator(".project-card", { hasText: "my-cool-game" }).locator(".project-open").click();
  await page.evaluate(() => (window as unknown as { __releaseServiceWorker: () => void }).__releaseServiceWorker());
  await expect(page.locator("iframe")).toHaveAttribute("src", "about:blank");
});


test("the game frame has an opaque origin but can still send runtime messages", async ({ page }) => {
  await page.goto("/");
  const frame = page.locator(`iframe[title="${text.brand.name}"]`);
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  const result = await page.evaluate(() => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    return new Promise<{ kind: string; error?: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("sandbox message timed out")), 3000);
      const onMessage = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(event.data as { kind: string; error?: string });
      };
      window.addEventListener("message", onMessage);
      iframe.srcdoc = `<script>try { parent.document.title = "changed"; parent.postMessage({ kind: "accessible" }, "*"); } catch (error) { parent.postMessage({ kind: "blocked", error: error.name }, "*"); }</script>`;
    });
  });
  expect(result).toEqual({ kind: "blocked", error: "SecurityError" });
});

test("export build errors are reported in the Problems panel", async ({ page }) => {
  await openCode(page);
  await page.getByRole("button", { name: `${text.code.delete} main.py` }).click();
  await page.getByTestId("delete-confirm").getByRole("button", { name: text.code.trashConfirm }).click();
  await page.getByRole("button", { name: text.header.export, exact: true }).click();
  await page.getByRole("button", { name: new RegExp(text.export.web) }).click();
  await expect(page.getByText(text.export.buildFailed)).toBeVisible();
});