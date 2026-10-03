import { expect, test, type Page } from "@playwright/test";
import { text } from "../../src/ui/text";

// 看代码 的左侧：新建、改名、删除。Local project work, so no sign-in and no model:
// every one of these has to be cancellable, and deleting always goes through the
// trash so a file is never one click from gone.

async function openCode(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: text.header.code }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
}

function composer(page: Page) {
  return page.getByTestId("composer");
}

async function openTrash(page: Page) {
  await page.getByTestId("trash").getByRole("button").first().click();
}

type StoredRow = { files: string[]; trash: string[] };

/** What IndexedDB actually holds. Saving is asynchronous, so a test that reloads
 * has to wait for the write to land instead of trusting the click's timing. */
async function storedProjects(page: Page): Promise<StoredRow[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gamekit", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<{ files: { path: string }[]; trash?: { file: { path: string } }[] }[]>((resolve, reject) => {
      const request = db.transaction("projects").objectStore("projects").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows.map((row) => ({
      files: row.files.map((file) => file.path),
      trash: (row.trash ?? []).map((entry) => entry.file.path),
    }));
  });
}

async function expectStored(page: Page, check: (row: StoredRow) => boolean) {
  await expect.poll(async () => (await storedProjects(page)).some(check), { timeout: 10_000 }).toBe(true);
}

test("a new file can be cancelled or created", async ({ page }) => {
  await openCode(page);

  await page.getByTestId("new-file").click();
  await expect(composer(page)).toBeVisible();
  await composer(page).getByRole("button", { name: text.code.cancel }).click();
  await expect(composer(page)).toHaveCount(0);
  await expect(page.locator(".tree")).not.toContainText("enemy.py");

  await page.getByTestId("new-file").click();
  await composer(page).getByRole("textbox").fill("game/enemy.py");
  await composer(page).getByRole("button", { name: text.code.create }).click();
  await expect(composer(page)).toHaveCount(0);
  await expect(page.locator(".tree")).toContainText("enemy.py");

  // Escape closes it too.
  await page.getByTestId("new-file").click();
  await composer(page).getByRole("textbox").press("Escape");
  await expect(composer(page)).toHaveCount(0);
});

test("renaming can be cancelled, and keeping the same name is not an error", async ({ page }) => {
  await openCode(page);

  await page.getByRole("button", { name: `${text.code.rename} main.py` }).click();
  await expect(composer(page)).toBeVisible();
  await composer(page).getByRole("button", { name: text.code.cancel }).click();
  await expect(page.locator(".tree")).toContainText("main.py");

  await page.getByRole("button", { name: `${text.code.rename} main.py` }).click();
  await composer(page).getByRole("button", { name: text.code.rename }).click();
  await expect(composer(page)).toHaveCount(0);
  await expect(page.locator(".notice")).toHaveCount(0);
  await expect(page.locator(".tree")).toContainText("main.py");

  // A new name really is applied, and a taken name is refused without closing the box.
  await page.getByRole("button", { name: `${text.code.rename} main.py` }).click();
  await composer(page).getByRole("textbox").fill("game/player.py");
  await expect(composer(page)).toContainText(text.code.pathTaken);
  await composer(page).getByRole("textbox").press("Escape");
  await expect(page.locator(".tree")).toContainText("main.py");
});

test("deleting asks first, then goes to the trash, and can come back", async ({ page }) => {
  await openCode(page);
  await expect(page.locator(".tree")).toContainText("main.py");

  await page.getByRole("button", { name: `${text.code.delete} main.py` }).click();
  const confirm = page.getByTestId("delete-confirm");
  await expect(confirm).toContainText(text.code.confirmTrash("main.py"));
  await confirm.getByRole("button", { name: text.code.cancel }).click();
  await expect(page.locator(".tree")).toContainText("main.py");

  await page.getByRole("button", { name: `${text.code.delete} main.py` }).click();
  await page.getByTestId("delete-confirm").getByRole("button", { name: text.code.trashConfirm }).click();
  await expect(page.locator(".tree")).not.toContainText("main.py");
  await expect(page.locator(".notice")).toContainText(text.code.trashed("main.py"));

  // It reaches IndexedDB, survives a reload, and restore brings it back.
  await expectStored(page, (row) => !row.files.includes("main.py") && row.trash.includes("main.py"));
  await page.reload();
  await page.getByRole("tab", { name: text.header.code }).click();
  await expect(page.locator(".tree")).not.toContainText("main.py");
  await openTrash(page);
  await expect(page.getByTestId("trash")).toContainText("main.py");
  await page.getByTestId("trash").getByRole("button", { name: text.code.restore }).click();
  await expect(page.locator(".tree")).toContainText("main.py");
  await expectStored(page, (row) => row.files.includes("main.py") && !row.trash.includes("main.py"));

  // Undo also brings a delete back.
  await page.getByRole("button", { name: `${text.code.delete} main.py` }).click();
  await page.getByTestId("delete-confirm").getByRole("button", { name: text.code.trashConfirm }).click();
  await expect(page.locator(".tree")).not.toContainText("main.py");
  await page.getByRole("button", { name: text.header.undo }).click();
  await expect(page.locator(".tree")).toContainText("main.py");
});

test("only 彻底删除 and 清空回收站 remove a file for good, and both ask first", async ({ page }) => {
  await openCode(page);
  await page.getByRole("button", { name: `${text.code.delete} main.py` }).click();
  await page.getByTestId("delete-confirm").getByRole("button", { name: text.code.trashConfirm }).click();
  await expect(page.locator(".tree")).not.toContainText("main.py");

  await openTrash(page);
  await page.getByTestId("trash").getByRole("button", { name: `${text.code.purge} main.py` }).click();
  const purge = page.getByTestId("purge-confirm");
  await expect(purge).toContainText(text.code.confirmPurge("main.py"));
  await purge.getByRole("button", { name: text.code.cancel }).click();
  await expect(page.getByTestId("trash")).toContainText("main.py");
  await expect(page.getByTestId("trash").getByText(text.code.trashEmpty)).toHaveCount(0);

  await page.getByTestId("trash").getByRole("button", { name: `${text.code.purge} main.py` }).click();
  await page.getByTestId("purge-confirm").getByRole("button", { name: text.code.purgeConfirm }).click();
  await expect(page.getByTestId("trash")).toContainText(text.code.trashEmpty);
});
