/** Error codes the page understands. Keep in sync with `src/lib/account.ts`. */
export type ErrorCode =
  | "sign_in_required"
  | "not_allowed"
  | "not_configured"
  | "bad_request"
  | "not_found"
  | "upstream_failed";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  return json({ error: message, code: "upstream_failed" }, 502);
}

export function redirect(location: string, headers: HeadersInit = {}): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store", ...headers } });
}
