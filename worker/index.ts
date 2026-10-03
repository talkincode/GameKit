import { complete, image, modelInfo, readImageRequest, readMessages, readSoundRequest, sound } from "./ai";
import type { GameKitEnv } from "./env";
import { HttpError, errorResponse, json, redirect } from "./http";
import { DEV_COOKIE, readCookie, requireIdentity, usesLocalAuth } from "./identity";

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
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/login") return await login(request, env, url);
      if (url.pathname === "/api/logout") return logout(env, url);
      if (!url.pathname.startsWith("/api/")) return json({ error: "Not found.", code: "not_found" }, 404);

      const identity = await requireIdentity(request, env);
      if (url.pathname === "/api/me" && request.method === "GET") return json({ email: identity.email });
      // What the model can take; the app sizes the assistant's memory with it.
      if (url.pathname === "/api/ai" && request.method === "GET") return json(modelInfo(env));
      if (url.pathname === "/api/ai" && request.method === "POST") return await ai(request, env);
      return json({ error: "Not found.", code: "not_found" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  },
} satisfies ExportedHandler<GameKitEnv>;

async function ai(request: Request, env: GameKitEnv): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "bad_request", "The request body must be JSON.");
  }
  if (!body || typeof body !== "object") throw new HttpError(400, "bad_request", "The request body must be an object.");
  const record = body as { op?: unknown; messages?: unknown; kind?: unknown; prompt?: unknown; variation?: unknown };
  if (record.op === "complete") {
    const answer = await complete(env, readMessages(record.messages));
    return json({ text: answer.text, usage: answer.usage });
  }
  if (record.op === "image") return json(await image(env, readImageRequest(record)));
  // Sound: the model picks a patch or a few bars; the browser renders the samples.
  if (record.op === "sound") return json({ text: (await sound(env, readSoundRequest(record))).text });
  throw new HttpError(400, "bad_request", "Unknown AI operation.");
}

const LOGIN_RESULT: Record<number, string> = { 401: "failed", 403: "denied", 503: "unavailable" };

async function login(request: Request, env: GameKitEnv, url: URL): Promise<Response> {
  let local: boolean;
  try {
    local = usesLocalAuth(env, url);
  } catch {
    return redirect("/?login=unavailable");
  }

  if (local && request.method === "POST") {
    const form = await request.formData();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    return redirect("/api/login", { "Set-Cookie": devCookie(email, 60 * 60 * 24) });
  }
  if (local && !readCookie(request, DEV_COOKIE)) return localSignInForm();

  try {
    await requireIdentity(request, env);
    return redirect("/?login=ok");
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

function localSignInForm(): Response {
  const html = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GameKit 本地登录</title>
<body style="font-family: system-ui; max-width: 28rem; margin: 4rem auto; padding: 0 1rem">
<h1>本地开发登录</h1>
<p>这是本地开发用的替身。正式站点使用 Cloudflare Access 的 GitHub 登录。</p>
<form method="post" action="/api/login">
<label>GitHub 账号邮箱 <input name="email" type="email" required autofocus></label>
<button type="submit">登录</button>
</form>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
