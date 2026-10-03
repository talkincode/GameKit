import { describe, expect, it } from "vitest";
import { CollabSession } from "./collab";
import type { GameKitEnv } from "./env";
import worker from "./index";

function mockKV(): KVNamespace {
  const map = new Map<string, { value: string; metadata?: any; expiresAt?: number }>();
  return {
    async get(key: string, options?: any) {
      const item = map.get(key);
      if (!item) return null;
      if (item.expiresAt && Date.now() > item.expiresAt) {
        map.delete(key);
        return null;
      }
      if (options?.type === "json") {
        try {
          return JSON.parse(item.value);
        } catch {
          return null;
        }
      }
      return item.value;
    },
    async put(key: string, value: string, options?: any) {
      const expiresAt = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined;
      map.set(key, { value, metadata: options?.metadata, expiresAt });
    },
    async delete(key: string) {
      map.delete(key);
    },
    async list(options?: any) {
      const prefix = options?.prefix ?? "";
      const keys = Array.from(map.keys())
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name, metadata: map.get(name)?.metadata }));
      return { keys, list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
}

function mockCollabNamespace(): DurableObjectNamespace {
  const sessions = new Map<string, CollabSession>();
  return {
    idFromName(name: string) {
      return { toString: () => name, name };
    },
    get(id: any) {
      const name = id.name ?? id.toString();
      let session = sessions.get(name);
      if (!session) {
        const store = new Map<string, any>();
        const ctx: any = {
          storage: {
            async get(k: string) {
              return store.get(k);
            },
            async put(k: string, v: any) {
              store.set(k, v);
            },
            async deleteAll() {
              store.clear();
            },
          },
        };
        session = new CollabSession(ctx, {} as any);
        sessions.set(name, session);
      }
      return session;
    },
  } as unknown as DurableObjectNamespace;
}

function testEnv(): GameKitEnv {
  return {
    OAUTH_KV: mockKV(),
    COLLAB: mockCollabNamespace(),
    MCP_OBJECT: {} as any,
    LOCAL_DEV_AUTH: "1",
    ALLOW_GITHUB_USERS: "kid@example.com",
  };
}

describe("MCP OAuth discovery and endpoints", () => {
  it("challenges unauthenticated requests to /mcp with 401 and resource_metadata", async () => {
    const env = testEnv();
    const request = new Request("https://gamekit.talkincode.net/mcp", { method: "POST" });
    const response = await worker.fetch(request as never, env, {} as never);
    expect(response.status).toBe(401);
    const authHeader = response.headers.get("WWW-Authenticate") ?? "";
    expect(authHeader).toContain('Bearer realm="OAuth"');
    expect(authHeader).toContain('resource_metadata="https://gamekit.talkincode.net/.well-known/oauth-protected-resource/mcp"');
    expect(authHeader).toContain('scope="mcp:read"');
  });

  it("serves protected resource metadata matching RFC 9728", async () => {
    const env = testEnv();
    const request = new Request("https://gamekit.talkincode.net/.well-known/oauth-protected-resource/mcp");
    const response = await worker.fetch(request as never, env, {} as never);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.resource).toBe("https://gamekit.talkincode.net/mcp");
    expect(body.authorization_servers).toEqual(["https://gamekit.talkincode.net"]);
  });

  it("serves authorization server metadata matching RFC 8414", async () => {
    const env = testEnv();
    const request = new Request("https://gamekit.talkincode.net/.well-known/oauth-authorization-server");
    const response = await worker.fetch(request as never, env, {} as never);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.issuer).toBe("https://gamekit.talkincode.net");
    expect(body.authorization_endpoint).toBe("https://gamekit.talkincode.net/oauth/authorize");
    expect(body.token_endpoint).toBe("https://gamekit.talkincode.net/oauth/token");
    expect(body.registration_endpoint).toBe("https://gamekit.talkincode.net/oauth/register");
  });
});

describe("OAuth 2.1 full authorization & MCP collaboration loop", () => {
  it("completes DCR, consent, token exchange, and MCP tool interactions with ephemeral candidates", async () => {
    const env = testEnv();
    const email = "kid@example.com";
    const devCookie = `gamekit_dev_email=${encodeURIComponent(email)}`;

    // 1. Dynamic Client Registration (DCR)
    const registerReq = new Request("http://localhost/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Cursor Assistant",
        redirect_uris: ["http://127.0.0.1:8080/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      }),
    });
    const registerRes = await worker.fetch(registerReq as never, env, {} as never);
    expect(registerRes.status).toBe(201);
    const client = (await registerRes.json()) as { client_id: string; client_secret: string };
    expect(client.client_id).toBeTruthy();
    expect(client.client_secret).toBeTruthy();

    // 2. Authorize - unauthenticated redirects to login
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

    const unauthReq = new Request(
      `http://localhost/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent(
        "http://127.0.0.1:8080/callback",
      )}&response_type=code&scope=mcp:read+mcp:write&code_challenge=${challenge}&code_challenge_method=S256&state=xyz123`,
    );
    const unauthRes = await worker.fetch(unauthReq as never, env, {} as never);
    expect(unauthRes.status).toBe(302);
    expect(unauthRes.headers.get("Location")).toContain("/api/login");

    // 3. Authorize GET - authenticated user sees consent page
    const authGetReq = new Request(
      `http://localhost/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent(
        "http://127.0.0.1:8080/callback",
      )}&response_type=code&scope=mcp:read+mcp:write&code_challenge=${challenge}&code_challenge_method=S256&state=xyz123`,
      { headers: { Cookie: devCookie } },
    );
    const authGetRes = await worker.fetch(authGetReq as never, env, {} as never);
    expect(authGetRes.status).toBe(200);
    const consentHtml = await authGetRes.text();
    expect(consentHtml).toContain("Cursor Assistant");
    expect(consentHtml).toContain("kid@example.com");
    expect(consentHtml).toContain('name="handle"');

    // Extract handle from HTML
    const handleMatch = /name="handle" value="([^"]+)"/.exec(consentHtml);
    expect(handleMatch).toBeTruthy();
    const handle = handleMatch![1];

    // Extract cookie from beginConsent
    const consentCookie = authGetRes.headers.get("Set-Cookie") ?? "";

    // 4. Authorize POST - approve consent
    const authForm = new URLSearchParams();
    authForm.set("handle", handle);
    authForm.set("decision", "approve");
    authForm.append("scope", "mcp:read");
    authForm.append("scope", "mcp:write");

    const authPostReq = new Request("http://localhost/oauth/authorize", {
      method: "POST",
      headers: {
        Cookie: `${devCookie}; ${consentCookie}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: authForm.toString(),
    });
    const authPostRes = await worker.fetch(authPostReq as never, env, {} as never);
    expect(authPostRes.status).toBe(302);
    const redirectUrl = new URL(authPostRes.headers.get("Location")!);
    expect(redirectUrl.origin).toBe("http://127.0.0.1:8080");
    expect(redirectUrl.searchParams.get("state")).toBe("xyz123");
    const code = redirectUrl.searchParams.get("code");
    expect(code).toBeTruthy();

    // 5. Token exchange at /oauth/token
    const tokenParams = new URLSearchParams();
    tokenParams.set("grant_type", "authorization_code");
    tokenParams.set("code", code!);
    tokenParams.set("client_id", client.client_id);
    tokenParams.set("client_secret", client.client_secret);
    tokenParams.set("redirect_uri", "http://127.0.0.1:8080/callback");
    tokenParams.set("code_verifier", "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");

    const tokenReq = new Request("http://localhost/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    });
    const tokenRes = await worker.fetch(tokenReq as never, env, {} as never);
    expect(tokenRes.status).toBe(200);
    const tokenData = (await tokenRes.json()) as { access_token: string; token_type: string };
    expect(tokenData.access_token).toBeTruthy();
    expect(tokenData.token_type.toLowerCase()).toBe("bearer");

    const bearer = `Bearer ${tokenData.access_token}`;

    // 6. Child starts collaboration in studio via /api/collab/start
    const startReq = new Request("http://localhost/api/collab/start", {
      method: "POST",
      headers: { Cookie: devCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        snapshot: {
          projectId: "proj-123",
          name: "弹球小游戏",
          files: [
            { path: "main.py", text: "import pygame\nprint('hello')\n" },
            { path: "assets/ball.png", bytes: 1024 },
          ],
        },
      }),
    });
    const startRes = await worker.fetch(startReq as never, env, {} as never);
    expect(startRes.status).toBe(200);

    // 7. External MCP client calls initialize on /mcp
    const mcpInitReq = new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        Authorization: bearer,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "Cursor", version: "1.0" },
        },
      }),
    });
    const mcpInitRes = await worker.fetch(mcpInitReq as never, env, {} as never);
    expect(mcpInitRes.status).toBe(200);

    // 8. External MCP calls list_files
    const listReq = new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        Authorization: bearer,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "list_files", arguments: {} },
      }),
    });
    const listRes = await worker.fetch(listReq as never, env, {} as never);
    expect(listRes.status).toBe(200);
    const listText = await listRes.text();
    expect(listText).toContain("main.py");
    expect(listText).toContain("assets/ball.png（二进制素材，1024 字节）");

    // 9. External MCP calls read_file
    const readReq = new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        Authorization: bearer,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "read_file", arguments: { path: "main.py" } },
      }),
    });
    const readRes = await worker.fetch(readReq as never, env, {} as never);
    expect(readRes.status).toBe(200);
    const readText = await readRes.text();
    expect(readText).toContain("import pygame");

    // 10. External MCP proposes modifications via propose_files
    const proposeReq = new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        Authorization: bearer,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "propose_files",
          arguments: {
            say: "我帮你添加了球的弹跳速度变量",
            files: [{ path: "main.py", text: "import pygame\nSPEED = 5\n" }],
          },
        },
      }),
    });
    const proposeRes = await worker.fetch(proposeReq as never, env, {} as never);
    expect(proposeRes.status).toBe(200);
    const proposeText = await proposeRes.text();
    expect(proposeText).toContain("已交给孩子确认");

    // 11. Child's studio polls /api/collab/sync and receives the candidate
    const syncReq = new Request("http://localhost/api/collab/sync", {
      method: "POST",
      headers: { Cookie: devCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        snapshot: {
          projectId: "proj-123",
          name: "弹球小游戏",
          files: [{ path: "main.py", text: "import pygame\nprint('hello')\n" }],
        },
      }),
    });
    const syncRes = await worker.fetch(syncReq as never, env, {} as never);
    expect(syncRes.status).toBe(200);
    const syncData = (await syncRes.json()) as {
      candidates: { id: string; say: string; files: { path: string; text: string }[] }[];
    };
    expect(syncData.candidates.length).toBe(1);
    expect(syncData.candidates[0].say).toBe("我帮你添加了球的弹跳速度变量");
    expect(syncData.candidates[0].files[0].text).toBe("import pygame\nSPEED = 5\n");
    const candidateId = syncData.candidates[0].id;

    // 12. Child settles (adopts) the candidate
    const settleReq = new Request("http://localhost/api/collab/sync", {
      method: "POST",
      headers: { Cookie: devCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        settled: [{ candidateId, adopted: true }],
        snapshot: {
          projectId: "proj-123",
          name: "弹球小游戏",
          files: [{ path: "main.py", text: "import pygame\nSPEED = 5\n" }],
        },
      }),
    });
    const settleRes = await worker.fetch(settleReq as never, env, {} as never);
    expect(settleRes.status).toBe(200);
    const settledData = (await settleRes.json()) as { candidates: unknown[] };
    expect(settledData.candidates.length).toBe(0);

    // 13. External MCP checks activity log
    const actReq = new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        Authorization: bearer,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "read_activity", arguments: {} },
      }),
    });
    const actRes = await worker.fetch(actReq as never, env, {} as never);
    expect(actRes.status).toBe(200);
    const actText = await actRes.text();
    expect(actText).toContain(`孩子采用了 ${candidateId}`);
  });
});
