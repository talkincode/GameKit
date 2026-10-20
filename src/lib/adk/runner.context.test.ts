import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetAllRunners, projectRunner } from "./runner";

const sent: unknown[] = [];
const rows = new Map<string, unknown>();

/** Just enough IndexedDB for the session store: get/put by id. */
function installMemoryDb() {
  const store = {
    get(id: string) {
      const request = { result: rows.get(id), onsuccess: null as null | (() => void), onerror: null as null | (() => void) };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
    put(row: { id: string }) {
      rows.set(row.id, row);
      const request = { result: row.id, onsuccess: null as null | (() => void), onerror: null as null | (() => void) };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  vi.stubGlobal("indexedDB", {
    open() {
      const request = {
        result: {
          objectStoreNames: { contains: () => true },
          close() {},
          transaction() {
            return { objectStore: () => store };
          },
        },
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
        onupgradeneeded: null as null | (() => void),
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
}

beforeEach(() => {
  rows.clear();
  installMemoryDb();
});

afterEach(() => {
  forgetAllRunners();
  sent.length = 0;
  vi.unstubAllGlobals();
});

function stubModel() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: unknown[] };
      sent.push(body.messages);
      return new Response(
        JSON.stringify({ text: `{"say":"ok-${sent.length}"}`, requestId: `gk_${sent.length}`, usage: { promptTokens: 10, completionTokens: 2 } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
}

describe("project conversation", () => {
  it("sends earlier turns on the next run", async () => {
    stubModel();
    const runner = projectRunner({ system: "be brief", sessionId: "proj-1", budgetTokens: 8_000 });
    await runner.run([{ text: "make a cat game" }]);
    await runner.run([{ text: "add a score" }]);
    const second = sent[1] as { role: string; content: string }[];
    expect(second.map((message) => message.content)).toEqual(
      expect.arrayContaining([expect.stringContaining("make a cat game"), expect.stringContaining("add a score")]),
    );
  });

  it("reloads the conversation after the runner is dropped", async () => {
    stubModel();
    const first = projectRunner({ system: "be brief", sessionId: "proj-2", budgetTokens: 8_000 });
    await first.run([{ text: "make a cat game" }]);
    forgetAllRunners();
    const second = projectRunner({ system: "be brief", sessionId: "proj-2", budgetTokens: 8_000 });
    await second.run([{ text: "add a score" }]);
    const messages = sent[1] as { role: string; content: string }[];
    expect(messages.map((message) => message.content)).toEqual(
      expect.arrayContaining([expect.stringContaining("make a cat game"), expect.stringContaining("add a score")]),
    );
  });
});
