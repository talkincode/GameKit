import { workerRequestId } from "../shared/assistant-error";
import { complete, image, modelInfo, readImageRequest, readMessages, readSoundRequest, sound, type ChatAnswer } from "./ai";
import { describeAssistantError, writeAiLog } from "./assistant-log";
import { collabRoute } from "./collab-routes";
import type { GameKitEnv } from "./env";
import { HttpError, errorResponse, json, redirect } from "./http";
import { DEV_COOKIE, readCookie, requireIdentity, usesLocalAuth } from "./identity";
import { getOAuthProvider, handleAuthorize } from "./oauth";

export { GameKitMcp } from "./mcp";
export { CollabSession } from "./collab";

/**
 * Routes. Static files (the studio page, PWA shell) never reach this Worker.
 *
 * Every `/api/*` route needs an allowed identity (see identity.ts). There are no
 * anonymous API routes; unknown paths are refused by the gate before the 404.
 * Sign-in and sign-out are top-level navigations, not fetches:
 *
 * - GET /api/login   Cloudflare Access signs the user in, then we send them back to `/?login=<result>`.
 * - GET /api/logout  Ends the Access session.
 */
const defaultHandler: ExportedHandler<GameKitEnv> = {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/oauth/authorize") return await handleAuthorize(request, env, url);
      if (url.pathname === "/api/login") return await login(request, env, url);
      if (url.pathname === "/api/logout") return logout(env, url);

      if (url.pathname.startsWith("/api/collab/")) {
        const identity = await requireIdentity(request, env);
        const action = url.pathname.slice("/api/collab/".length);
        return await collabRoute(request, env, identity.email, action);
      }

      if (!url.pathname.startsWith("/api/")) return json({ error: "Not found.", code: "not_found" }, 404);

      // Assistant posts mint a requestId before the gate, so a refusal is still look-up-able.
      // handleAi runs the same identity check; this is not an anonymous route.
      if (url.pathname === "/api/ai" && request.method === "POST") return await handleAi(request, env);

      const identity = await requireIdentity(request, env);
      if (url.pathname === "/api/me" && request.method === "GET") return json({ email: identity.email });
      // What the model can take; the app sizes the assistant's memory with it.
      if (url.pathname === "/api/ai" && request.method === "GET") return json(modelInfo(env));
      return json({ error: "Not found.", code: "not_found" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  },
};

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const provider = getOAuthProvider(origin, defaultHandler);
    return await provider.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<GameKitEnv>;

/**
 * Every assistant POST gets a requestId before the identity gate, so a refused
 * sign-in is still something an adult can look up. The log line is written here,
 * once, for both success and failure.
 */
async function handleAi(request: Request, env: GameKitEnv): Promise<Response> {
  const requestId = workerRequestId();
  const started = Date.now();
  let op = "unknown";
  try {
    await requireIdentity(request, env);
    const result = await runAi(request, env);
    op = result.op;
    writeAiLog({
      source: "gamekit.ai",
      requestId,
      op,
      ok: true,
      httpStatus: 200,
      ms: Date.now() - started,
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
    });
    return json({ ...result.payload, requestId }, 200, { "x-request-id": requestId });
  } catch (error) {
    if (error instanceof HttpError && error.op) op = error.op;
    const described = describeAssistantError(error, requestId);
    writeAiLog({
      source: "gamekit.ai",
      requestId,
      op,
      ok: false,
      code: described.category,
      httpStatus: described.status,
      ms: Date.now() - started,
      detail: described.detail,
    });
    return json(described.body, described.status, { "x-request-id": requestId });
  }
}

async function runAi(
  request: Request,
  env: GameKitEnv,
): Promise<{ op: string; payload: Record<string, unknown>; usage?: ChatAnswer["usage"] }> {
  let op = "unknown";
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, "bad_request", "The request body must be JSON.", {
        assistantCode: "bad_request",
        detail: "request body was not JSON",
      });
    }
    if (!body || typeof body !== "object") {
      throw new HttpError(400, "bad_request", "The request body must be an object.", {
        assistantCode: "bad_request",
        detail: "request body was not an object",
      });
    }
    const record = body as { op?: unknown; messages?: unknown; kind?: unknown; prompt?: unknown; variation?: unknown };
    op = typeof record.op === "string" ? record.op.slice(0, 32) : "unknown";
    if (record.op === "complete") {
      const answer = await complete(env, readMessages(record.messages));
      return { op, payload: { text: answer.text, usage: answer.usage }, usage: answer.usage };
    }
    if (record.op === "image") {
      const drawn = await image(env, readImageRequest(record));
      return { op, payload: drawn };
    }
    // Sound: the model picks a patch or a few bars; the browser renders the samples.
    if (record.op === "sound") {
      const answer = await sound(env, readSoundRequest(record));
      return { op, payload: { text: answer.text }, usage: answer.usage };
    }
    throw new HttpError(400, "bad_request", "Unknown AI operation.", {
      assistantCode: "bad_request",
      detail: "unknown AI operation",
    });
  } catch (error) {
    if (error instanceof HttpError) error.op = op;
    throw error;
  }
}

const LOGIN_RESULT: Record<number, string> = { 401: "failed", 403: "denied", 503: "unavailable" };

async function login(request: Request, env: GameKitEnv, url: URL): Promise<Response> {
  const returnTo = url.searchParams.get("return_to");
  const target = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/?login=ok";

  let local: boolean;
  try {
    local = usesLocalAuth(env, url);
  } catch {
    return redirect("/?login=unavailable");
  }

  if (local && request.method === "POST") {
    const form = await request.formData();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const formReturnTo = String(form.get("return_to") ?? "");
    const targetUrl =
      formReturnTo && formReturnTo.startsWith("/") && !formReturnTo.startsWith("//")
        ? `/api/login?return_to=${encodeURIComponent(formReturnTo)}`
        : "/api/login";
    return redirect(targetUrl, { "Set-Cookie": devCookie(email, 60 * 60 * 24) });
  }
  if (local && !readCookie(request, DEV_COOKIE)) return localSignInForm(returnTo ?? undefined);

  try {
    await requireIdentity(request, env);
    return redirect(target);
  } catch (error) {
    if (!(error instanceof HttpError) || !LOGIN_RESULT[error.status]) throw error;
    // Locally, forget a refused email so the form can be used again.
    const headers: HeadersInit = local ? { "Set-Cookie": devCookie("", 0) } : {};
    return redirect(`/?login=${LOGIN_RESULT[error.status]}`, headers);
  }
}

function logout(env: GameKitEnv, url: URL): Response {
  let local: boolean;
  try {
    local = usesLocalAuth(env, url);
  } catch {
    return redirect("/?login=out");
  }
  if (local) return redirect("/?login=out", { "Set-Cookie": devCookie("", 0) });
  return redirect("/cdn-cgi/access/logout");
}

function devCookie(value: string, maxAge: number): string {
  return `${DEV_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function localSignInForm(returnTo?: string): Response {
  const hiddenReturn = returnTo ? `<input type="hidden" name="return_to" value="${returnTo}">` : "";
  const html = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GameKit 本地登录</title>
<body style="font-family: system-ui; max-width: 28rem; margin: 4rem auto; padding: 0 1rem">
<h1>本地开发登录</h1>
<p>这是本地开发用的替身。正式站点使用 Cloudflare Access 的 GitHub 登录。</p>
<form method="post" action="/api/login">
${hiddenReturn}
<label>GitHub 账号邮箱 <input name="email" type="email" required autofocus></label>
<button type="submit">登录</button>
</form>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
