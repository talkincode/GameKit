export type GamekitEvent =
  | { source: "gamekit"; type: "archive-request" }
  | { source: "gamekit"; type: "console"; text: string }
  | { source: "gamekit"; type: "tick"; fps: number; frameMs: number }
  | { source: "gamekit"; type: "raf"; fps: number }
  | { source: "gamekit"; type: "input"; detail: string }
  | { source: "gamekit"; type: "ready" };

export function parseGamekitEvent(data: unknown): GamekitEvent | null {
  const value = typeof data === "string" ? safeParse(data) : data;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.source !== "gamekit" || typeof record.type !== "string") return null;
  if (record.type === "archive-request") return { source: "gamekit", type: "archive-request" };
  if (record.type === "console" && typeof record.text === "string") return { source: "gamekit", type: "console", text: record.text };
  if (record.type === "ready") return { source: "gamekit", type: "ready" };
  if (record.type === "input" && typeof record.detail === "string") {
    return { source: "gamekit", type: "input", detail: record.detail };
  }
  if (record.type === "tick" && typeof record.fps === "number" && typeof record.frameMs === "number") {
    return { source: "gamekit", type: "tick", fps: record.fps, frameMs: record.frameMs };
  }
  if (record.type === "raf" && typeof record.fps === "number") return { source: "gamekit", type: "raf", fps: record.fps };
  return null;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
