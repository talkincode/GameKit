import { afterEach, describe, expect, it, vi } from "vitest";
import { publishPlay } from "./session";

function memoryCache() {
  const entries = new Map<string, Response>();
  const key = (request: Request | string) => (typeof request === "string" ? new URL(request, location.origin).href : request.url);
  const cache = {
    async keys() {
      return [...entries.keys()].map((url) => new Request(url));
    },
    async delete(request: Request | string) {
      return entries.delete(key(request));
    },
    async put(request: Request | string, response: Response) {
      entries.set(key(request), response);
    },
  };
  return { cache, entries };
}

describe("publishPlay", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps another tab's active preview files when publishing a new session", async () => {
    vi.stubGlobal("location", new URL("https://gamekit.test/"));
    const { cache, entries } = memoryCache();
    vi.stubGlobal("caches", { open: async () => cache } as unknown as CacheStorage);
    const bundle = { html: "<html></html>", archiveName: "gamekit", apk: new Uint8Array([1]), favicon: new Uint8Array([2]) };

    await publishPlay("tab-a", bundle as never);
    await publishPlay("tab-b", bundle as never);

    expect([...entries.keys()]).toEqual(
      expect.arrayContaining([
        "https://gamekit.test/play/tab-a/index.html",
        "https://gamekit.test/play/tab-a/gamekit.apk",
        "https://gamekit.test/play/tab-a/favicon.png",
        "https://gamekit.test/play/tab-b/index.html",
        "https://gamekit.test/play/tab-b/gamekit.apk",
        "https://gamekit.test/play/tab-b/favicon.png",
      ]),
    );
  });
});