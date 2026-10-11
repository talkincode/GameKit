/**
 * On-device diagnostic journal.
 *
 * A memory ring of the latest 200 rows, mirrored into IndexedDB. It never
 * uploads, and a failed write leaves the memory copy in place. Rows store a
 * short summary and a public failure, never a prompt or the child's source.
 */
import { isAssistantCode, redact, type AssistantCode, type PublicFailure } from "../../../shared/assistant-error";
import { loadJournal, saveJournal } from "../storage";

export const LOG_LIMIT = 200;

export type LogArea = "assistant" | "preview" | "export";

export type LogEntry = {
  id: string;
  at: string;
  area: LogArea;
  ok: boolean;
  code: AssistantCode | "ok";
  message: string;
  detail: string;
  requestId: string;
  summary: string;
};

export type LogDraft = {
  area: LogArea;
  ok: boolean;
  code: AssistantCode | "ok";
  message: string;
  detail: string;
  requestId: string;
  summary: string;
  at?: string;
};

const AREAS: readonly LogArea[] = ["assistant", "preview", "export"];

let entries: LogEntry[] = [];
let hydrated = false;
const listeners = new Set<(rows: LogEntry[]) => void>();

export function pushLog(current: LogEntry[], entry: LogEntry, limit = LOG_LIMIT): LogEntry[] {
  const without = current.filter((item) => item.id !== entry.id);
  return [entry, ...without].slice(0, limit);
}

export function readLogs(): LogEntry[] {
  return entries;
}

export function subscribeLogs(listener: (rows: LogEntry[]) => void): () => void {
  listeners.add(listener);
  listener(entries);
  return () => listeners.delete(listener);
}

function emit(): void {
  const snapshot = entries;
  for (const listener of listeners) listener(snapshot);
}

function clipSummary(value: string): string {
  return redact(value).slice(0, 80);
}

export function normalizeLog(draft: LogDraft, id = ""): LogEntry {
  const area = AREAS.includes(draft.area) ? draft.area : "assistant";
  const code = draft.code === "ok" || isAssistantCode(draft.code) ? draft.code : "worker";
  return {
    id: id || crypto.randomUUID(),
    at: draft.at && draft.at.trim() ? draft.at : new Date().toISOString(),
    area,
    ok: draft.ok,
    code,
    message: redact(draft.message).slice(0, 200),
    detail: redact(draft.detail),
    requestId: redact(draft.requestId).slice(0, 80),
    summary: clipSummary(draft.summary),
  };
}

function persist(): void {
  if (typeof indexedDB === "undefined") return;
  const snapshot = entries;
  void saveJournal(snapshot).catch(() => {
    // The memory ring is still the copy the child can read.
  });
}

export function appendLog(draft: LogDraft): LogEntry {
  const entry = normalizeLog(draft);
  entries = pushLog(entries, entry);
  emit();
  persist();
  return entry;
}

/** A label for an image or sound call. Never the chat messages, which hold source. */
export function aiCallSummary(body: unknown): string {
  if (!body || typeof body !== "object") return "小助手";
  const record = body as { op?: unknown; prompt?: unknown; kind?: unknown };
  const op = typeof record.op === "string" ? record.op.slice(0, 24) : "ai";
  const kind = typeof record.kind === "string" ? record.kind.slice(0, 24) : "";
  const prompt = typeof record.prompt === "string" ? record.prompt.trim().slice(0, 60) : "";
  const head = kind ? `${op} ${kind}` : op;
  return prompt ? `${head}：${prompt}` : head;
}

export function requestIdFrom(value: unknown): string {
  if (value && typeof value === "object" && typeof (value as { requestId?: unknown }).requestId === "string") {
    const id = (value as { requestId: string }).requestId.trim();
    if (id) return id.slice(0, 80);
  }
  return "";
}

export function logFailure(area: LogArea, failure: PublicFailure, summary: string): LogEntry {
  return appendLog({
    area,
    ok: false,
    code: failure.code,
    message: failure.message,
    detail: failure.detail,
    requestId: failure.requestId,
    summary,
    at: failure.at,
  });
}

export function clearLogs(): void {
  entries = [];
  emit();
  persist();
}

function parseStored(value: unknown): LogEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<LogEntry>;
  if (typeof row.id !== "string" || typeof row.requestId !== "string" || typeof row.message !== "string") return null;
  if (row.area !== "assistant" && row.area !== "preview" && row.area !== "export") return null;
  const code = row.code === "ok" || isAssistantCode(row.code) ? row.code : "worker";
  return normalizeLog(
    {
      area: row.area,
      ok: row.ok === true,
      code,
      message: row.message,
      detail: typeof row.detail === "string" ? row.detail : "",
      requestId: row.requestId,
      summary: typeof row.summary === "string" ? row.summary : "",
      at: typeof row.at === "string" ? row.at : undefined,
    },
    row.id,
  );
}

/** Loads the saved ring once. Rows appended before this returns stay in front. */
export async function hydrateLogs(): Promise<void> {
  if (hydrated || typeof indexedDB === "undefined") {
    hydrated = true;
    return;
  }
  hydrated = true;
  try {
    const stored = await loadJournal();
    const parsed = stored.map(parseStored).filter((row): row is LogEntry => row !== null);
    const seen = new Set(entries.map((row) => row.id));
    const merged = [...entries];
    for (const row of parsed) {
      if (seen.has(row.id)) continue;
      merged.push(row);
      seen.add(row.id);
    }
    entries = merged.slice(0, LOG_LIMIT);
    emit();
  } catch {
    // Memory still works for this visit.
  }
}

/** Test hook. Production code does not call this. */
export function resetLogsForTests(): void {
  entries = [];
  hydrated = false;
  listeners.clear();
}
