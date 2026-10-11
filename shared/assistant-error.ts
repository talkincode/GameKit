/**
 * One catalog for assistant failures.
 *
 * The Worker returns these codes and the kid-facing sentence. The page uses the
 * same table, so a missing or old response still maps to the same words.
 * Details are short and public: a status code, a timeout, a parse position.
 * Never a key, a prompt, or the child's source.
 */

export const ASSISTANT_CODES = [
  "timeout",
  "rate_limit",
  "upstream",
  "parse",
  "network",
  "sign_in",
  "not_allowed",
  "not_configured",
  "bad_request",
  "worker",
  "empty",
  "preview",
  "export",
  "blocked",
] as const;

export type AssistantCode = (typeof ASSISTANT_CODES)[number];

/** Shown to the child. Technical detail stays in `PublicFailure.detail`. */
export const ASSISTANT_SAY: Record<AssistantCode, string> = {
  timeout: "小助手太忙了，稍后再试。",
  rate_limit: "小助手太忙了，稍后再试。",
  upstream: "小助手这次没连上，稍后再试。",
  parse: "小助手这次没想好，再试一次吧。",
  network: "网络断了，检查一下再试。",
  sign_in: "请登录后使用。",
  not_allowed: "这个账号还没有开通 GameKit。请让家长或老师帮你开通。",
  not_configured: "小助手还没准备好。做游戏不受影响。",
  bad_request: "这次请求不太对，再试一次吧。",
  worker: "小助手这边出了点问题，稍后再试。",
  empty: "小助手这次没想好，再试一次吧。",
  preview: "这次没能启动",
  export: "现在还不能导出，先修好「问题」里的报错。",
  blocked: "小助手改了几次还是没弄好。你可以在「看代码」里看看，或者换一种说法再试一次。",
};

export type PublicFailure = {
  requestId: string;
  code: AssistantCode;
  message: string;
  detail: string;
  at: string;
};

const SECRET =
  /bearer\s+\S+|\bsk-[A-Za-z0-9_-]{6,}\b|api[_-]?key\s*[:=]\s*\S+|x-goog-api-key\s*[:=]\s*\S+/gi;

/** Drops secrets, emails, and URLs, then keeps a short public sentence. */
export function redact(value: string): string {
  return value
    .replace(SECRET, "[redacted]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function isAssistantCode(value: unknown): value is AssistantCode {
  return typeof value === "string" && (ASSISTANT_CODES as readonly string[]).includes(value);
}

export function workerRequestId(): string {
  return `gk_${crypto.randomUUID().replaceAll("-", "")}`;
}

/** A failure that never reached the Worker, so Cloudflare has nothing to look up. */
export function localRequestId(): string {
  return `local_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function makeFailure(code: AssistantCode, detail: string, requestId: string, at = new Date().toISOString()): PublicFailure {
  const id = requestId.trim().slice(0, 80) || localRequestId();
  return {
    requestId: id,
    code,
    message: ASSISTANT_SAY[code],
    detail: redact(detail) || code,
    at,
  };
}

/** Provider HTTP status → category. The child's own sign-in is not this map. */
export function categoryForUpstream(status: number): AssistantCode {
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limit";
  return "upstream";
}

/**
 * When the body has no `category`, the HTTP status is the only clue.
 * Legacy `code` values from the identity gate still map here.
 */
export function categoryFromHttp(status: number, legacyCode = ""): AssistantCode | null {
  if (legacyCode === "sign_in_required" || status === 401) return "sign_in";
  if (legacyCode === "not_allowed" || status === 403) return "not_allowed";
  if (legacyCode === "not_configured" || status === 503) return "not_configured";
  if (legacyCode === "bad_request" || status === 400) return "bad_request";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limit";
  if (status === 502) return "upstream";
  if (status >= 400) return "worker";
  return null;
}

export function isPublicFailure(value: unknown): value is PublicFailure {
  if (!value || typeof value !== "object") return false;
  const row = value as PublicFailure;
  return isAssistantCode(row.code) && typeof row.requestId === "string" && typeof row.message === "string" && typeof row.detail === "string" && typeof row.at === "string";
}

/** Reads a Worker error body. Missing fields fall back to the status. */
export function readPublicFailure(payload: unknown, status: number): PublicFailure {
  const row = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const category = isAssistantCode(row.category)
    ? row.category
    : (categoryFromHttp(status, typeof row.code === "string" ? row.code : "") ?? "worker");
  const requestId = typeof row.requestId === "string" ? row.requestId : localRequestId();
  const detail = typeof row.detail === "string" && row.detail.trim() ? row.detail : `HTTP ${status}`;
  const at = typeof row.at === "string" && row.at.trim() ? row.at : new Date().toISOString();
  return makeFailure(category, detail, requestId, at);
}

const PARSE_DETAIL =
  /json|did not return|did not describe|did not propose|did not answer|empty response|library asset|main\.py|text-edit|cannot rewrite|cannot replace|rejected/i;

/** A thrown model or parser error, including a GatewayError that already carries a failure. */
export function failureFromUnknown(error: unknown, requestId?: string): PublicFailure {
  if (error && typeof error === "object" && "failure" in error && isPublicFailure((error as { failure: unknown }).failure)) {
    return (error as { failure: PublicFailure }).failure;
  }
  const detail = error instanceof Error ? error.message : "The model call failed.";
  const code: AssistantCode = PARSE_DETAIL.test(detail) ? "parse" : "worker";
  return makeFailure(code, detail, requestId || localRequestId());
}

export function formatFailure(failure: PublicFailure, summary = ""): string {
  const lines = [
    summary ? `摘要：${redact(summary)}` : "",
    `分类：${failure.code}`,
    `说明：${failure.message}`,
    `编号：${failure.requestId}`,
    `时间：${failure.at}`,
    `细节：${failure.detail}`,
  ];
  return lines.filter(Boolean).join("\n");
}
