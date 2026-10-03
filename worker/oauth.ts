import {
  AuthorizationError,
  CimdFetchError,
  OAuthProvider,
  type ConsentDescription,
} from "@cloudflare/workers-oauth-provider";
import type { GameKitEnv } from "./env";
import { HttpError, redirect } from "./http";
import { requireIdentity, usesLocalAuth } from "./identity";
import { handleMcpRequest } from "./mcp";

const providerCache = new Map<string, OAuthProvider<GameKitEnv>>();

export function getOAuthProvider(origin: string, defaultHandler: ExportedHandler<GameKitEnv>): OAuthProvider<GameKitEnv> {
  let provider = providerCache.get(origin);
  if (!provider) {
    provider = new OAuthProvider<GameKitEnv>({
      apiRoute: "/mcp",
      apiHandler: {
        fetch: async (request: Request, env: GameKitEnv, ctx: ExecutionContext) => {
          const authProps = (ctx as unknown as { props?: { email?: string }; auth?: { userId?: string } });
          const email = authProps.props?.email ?? authProps.auth?.userId ?? "";
          if (!email) {
            return new Response("Unauthorized: missing email in token props", { status: 401 });
          }
          return await handleMcpRequest(request, env, email);
        },
      },
      defaultHandler,
      authorizeEndpoint: `${origin}/oauth/authorize`,
      tokenEndpoint: `${origin}/oauth/token`,
      clientRegistrationEndpoint: `${origin}/oauth/register`,
      scopesSupported: ["mcp:read", "mcp:write", "offline_access"],
      requiredScopes: ["mcp:read"],
      resourceMetadata: {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
      },
      clientIdMetadataDocumentEnabled: true,
      allowPrivateUseRedirectUris: true,
    });
    providerCache.set(origin, provider);
  }
  return provider;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function scopeLabel(scope: string): string {
  if (scope === "mcp:read") return "查看当前项目的代码与文件列表";
  if (scope === "mcp:write") return "提议修改项目文件（必须经由您在工作室中确认并采用才会生效）";
  if (scope === "offline_access") return "保持外部连接持续有效（离线刷新）";
  return scope;
}

function consentPageHtml(details: ConsentDescription, handle: string, email: string): string {
  const name = escapeHtml(details.clientName || "外部助手");
  const host = escapeHtml(details.redirectHost || "");
  const originDesc = details.clientDomain
    ? `该应用由 <strong>${escapeHtml(details.clientDomain)}</strong> 提供。`
    : "该应用通过动态注册连接。";
  const scopesHtml = details.scope
    .map(
      (scope) =>
        `<div style="margin: 0.5rem 0;"><label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;"><input type="checkbox" name="scope" value="${escapeHtml(
          scope,
        )}" checked style="width: 1.1rem; height: 1.1rem; accent-color: #22c55e;"> <span>${escapeHtml(
          scopeLabel(scope),
        )}</span></label></div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>授权协作 - GameKit</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background-color: #0d1117;
    color: #e6edf3;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    margin: 0;
    padding: 1.5rem;
    box-sizing: border-box;
  }
  .card {
    background-color: #161b22;
    border: 1px solid #30363d;
    border-radius: 1rem;
    max-width: 32rem;
    width: 100%;
    padding: 2rem;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
  }
  h1 { font-size: 1.4rem; margin: 0 0 1rem; color: #f0f6fc; }
  p { font-size: 0.95rem; line-height: 1.5; color: #8b949e; margin: 0.5rem 0; }
  .badge {
    display: inline-block;
    padding: 0.2rem 0.6rem;
    background: #238636;
    color: #fff;
    border-radius: 9999px;
    font-size: 0.8rem;
    margin-bottom: 1rem;
  }
  .box {
    background-color: #0d1117;
    border: 1px solid #21262d;
    border-radius: 0.75rem;
    padding: 1rem;
    margin: 1.25rem 0;
  }
  .warn {
    background-color: #2e1005;
    border: 1px solid #7c2d12;
    color: #fdba74;
    border-radius: 0.5rem;
    padding: 0.75rem;
    margin: 1rem 0;
    font-size: 0.875rem;
  }
  .actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1.5rem;
  }
  button {
    flex: 1;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: background 0.15s ease;
  }
  .btn-primary { background-color: #238636; color: white; }
  .btn-primary:hover { background-color: #2ea043; }
  .btn-secondary { background-color: #21262d; color: #c9d1d9; border: 1px solid #30363d; }
  .btn-secondary:hover { background-color: #30363d; }
</style>
</head>
<body>
<div class="card">
  <div class="badge">GameKit 外部协作授权</div>
  <h1>允许「${name}」连接协作？</h1>
  <p>${originDesc}</p>
  <p>授权后，该助手将连接至当前账号：<strong style="color: #f0f6fc;">${escapeHtml(email)}</strong>。</p>
  <p>访问凭证将交付给：<code style="color: #58a6ff;">${host}</code>。</p>

  ${
    details.redirectIsLoopback
      ? `<div class="warn"><strong>提示：</strong>访问将被发送至您电脑上的本地应用（${host}）。仅在您刚从该应用发起连接时继续。</div>`
      : ""
  }

  <form method="post" action="/oauth/authorize">
    <input type="hidden" name="handle" value="${escapeHtml(handle)}">
    <div class="box">
      <div style="font-size: 0.85rem; color: #8b949e; margin-bottom: 0.5rem; font-weight: 600;">申请的权限范围：</div>
      ${scopesHtml}
    </div>
    <div class="actions">
      <button type="submit" name="decision" value="approve" class="btn-primary">允许协作</button>
      <button type="submit" name="decision" value="deny" class="btn-secondary">拒绝</button>
    </div>
  </form>
</div>
</body>
</html>`;
}

export async function handleAuthorize(request: Request, env: GameKitEnv, url: URL): Promise<Response> {
  let identity: { email: string };
  try {
    identity = await requireIdentity(request, env);
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
      let isLocal = false;
      try {
        isLocal = usesLocalAuth(env, url);
      } catch {
        isLocal = false;
      }
      if (isLocal) {
        return redirect(`/api/login?return_to=${encodeURIComponent(url.pathname + url.search)}`);
      }
      return redirect(`/api/login?return_to=${encodeURIComponent(url.pathname + url.search)}`);
    }
    throw error;
  }

  const oauth = env.OAUTH_PROVIDER;
  if (!oauth) {
    throw new HttpError(500, "not_configured", "OAuth provider is not initialized.");
  }

  try {
    if (request.method === "GET") {
      const authRequest = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(authRequest);
      const consent = await oauth.beginConsent(authRequest);
      consent.headers.set("Content-Type", "text/html; charset=utf-8");
      return new Response(consentPageHtml(details, consent.handle, identity.email), {
        headers: consent.headers,
      });
    }

    if (request.method === "POST") {
      const form = await request.formData();
      const handle = String(form.get("handle") ?? "");
      const decision = String(form.get("decision") ?? "");

      if (decision !== "approve") {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }

      const rawScopes = form.getAll("scope").map(String);
      const scopes = rawScopes.length > 0 ? rawScopes : ["mcp:read"];
      const approved = await oauth.approveConsent(request, handle, { scope: scopes });
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: identity.email,
        metadata: {},
        scope: approved.request.scope,
        props: { email: identity.email },
      });
      approved.headers.set("Location", redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) {
      return Response.redirect(error.redirectTo, 302);
    }
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const message = error instanceof AuthorizationError ? error.description : "应用无法通过验证。";
      return new Response(escapeHtml(message || "授权错误"), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    throw error;
  }
}