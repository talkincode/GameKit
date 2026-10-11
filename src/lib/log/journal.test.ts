import { describe, expect, it } from "vitest";
import { makeFailure, redact } from "../../../shared/assistant-error";
import { LOG_LIMIT, appendLog, pushLog, readLogs, resetLogsForTests, type LogEntry } from "./journal";

function row(id: string): LogEntry {
  return {
    id,
    at: "2026-01-01T00:00:00.000Z",
    area: "assistant",
    ok: false,
    code: "rate_limit",
    message: "小助手太忙了，稍后再试。",
    detail: "text model HTTP 429",
    requestId: `gk_${id}`,
    summary: "做一个游戏",
  };
}

describe("assistant errors", () => {
  it("redacts keys, bearer tokens, urls, and emails", () => {
    const cleaned = redact("Bearer sk-abcdef123456 failed at https://model.example/v1 for kid@example.com");
    expect(cleaned).not.toContain("sk-abcdef123456");
    expect(cleaned).not.toContain("model.example");
    expect(cleaned).not.toContain("kid@example.com");
    expect(cleaned).toContain("[redacted]");
    expect(cleaned).toContain("[url]");
    expect(cleaned).toContain("[email]");
  });

  it("keeps a public detail and a kid sentence", () => {
    const failure = makeFailure("rate_limit", "text model HTTP 429, retry-after 3s Bearer sk-abcdef123456", "gk_abc");
    expect(failure.message).toBe("小助手太忙了，稍后再试。");
    expect(failure.code).toBe("rate_limit");
    expect(failure.requestId).toBe("gk_abc");
    expect(failure.detail).toContain("HTTP 429");
    expect(failure.detail).not.toContain("sk-");
  });
});

describe("log ring", () => {
  it("keeps the newest 200 rows", () => {
    const first = row("1");
    let entries = [first];
    for (let index = 2; index <= LOG_LIMIT + 5; index += 1) entries = pushLog(entries, row(String(index)));
    expect(entries).toHaveLength(LOG_LIMIT);
    expect(entries[0].id).toBe(String(LOG_LIMIT + 5));
    expect(entries.some((item) => item.id === "1")).toBe(false);
  });

  it("appends in memory without storing a prompt or a key", () => {
    resetLogsForTests();
    appendLog({
      area: "assistant",
      ok: false,
      code: "upstream",
      message: "小助手这次没连上，稍后再试。",
      detail: "Bearer sk-abcdef123456",
      requestId: "gk_one",
      summary: "print('hello') " + "x".repeat(200),
    });
    const [entry] = readLogs();
    expect(entry.requestId).toBe("gk_one");
    expect(entry.detail).not.toContain("sk-");
    expect(entry.summary.length).toBeLessThanOrEqual(80);
    resetLogsForTests();
  });
});
