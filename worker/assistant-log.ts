/**
 * One structured line per `/api/ai` POST, so Cloudflare logs can be searched
 * by requestId. The line is metadata only: no prompt, no source, no key.
 */
import { makeFailure, type AssistantCode } from "../shared/assistant-error";
import { HttpError, type ErrorCode } from "./http";

const LEGACY: Record<string, AssistantCode> = {
  sign_in_required: "sign_in",
  not_allowed: "not_allowed",
  not_configured: "not_configured",
  bad_request: "bad_request",
  not_found: "worker",
  upstream_failed: "upstream",
};

export type AiLogLine = {
  source: "gamekit.ai";
  requestId: string;
  op: string;
  ok: boolean;
  httpStatus: number;
  ms: number;
  code?: AssistantCode;
  detail?: string;
  promptTokens?: number;
  completionTokens?: number;
};

export function writeAiLog(line: AiLogLine): void {
  const safe: AiLogLine = {
    source: "gamekit.ai",
    requestId: line.requestId,
    op: line.op.slice(0, 32),
    ok: line.ok,
    httpStatus: line.httpStatus,
    ms: line.ms,
  };
  if (line.code) safe.code = line.code;
  if (line.detail) safe.detail = line.detail;
  if (typeof line.promptTokens === "number") safe.promptTokens = line.promptTokens;
  if (typeof line.completionTokens === "number") safe.completionTokens = line.completionTokens;
  console.log(JSON.stringify(safe));
}

/** Wire body. `code` stays the legacy gate code; `category` is the finer one. */
export type AssistantErrorBody = {
  error: string;
  code: ErrorCode;
  category: AssistantCode;
  requestId: string;
  message: string;
  detail: string;
  at: string;
};

export function describeAssistantError(error: unknown, requestId: string): {
  status: number;
  category: AssistantCode;
  detail: string;
  body: AssistantErrorBody;
} {
  let status = 500;
  let legacy: ErrorCode = "upstream_failed";
  let category: AssistantCode = "worker";
  let detail = "unexpected worker error";
  if (error instanceof HttpError) {
    status = error.status;
    legacy = error.code;
    category = error.assistantCode ?? LEGACY[error.code] ?? "worker";
    detail = error.detail || error.message;
  } else if (error instanceof Error) {
    detail = `unexpected ${error.name}`;
  }
  const failure = makeFailure(category, detail, requestId);
  return {
    status,
    category: failure.code,
    detail: failure.detail,
    body: {
      ...failure,
      error: failure.message,
      code: legacy,
      category: failure.code,
    },
  };
}

