import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameKitEnv } from "./env";
import { resetAccessKeys } from "./identity";
import worker from "./index";

// Tests call the real Worker handler. Only the network edges are faked:
// the Access signing keys and the OpenAI-compatible model endpoint.

const TEAM = "team.example.cloudflareaccess.com";
const AUD = "gamekit-aud";
const KID = "test-key";
const ALLOWED = "kid@example.com";
const MODEL_URL = "https://model.example.com";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

let keys: CryptoKeyPair;
let otherKeys: CryptoKeyPair;
let publicJwk: JsonWebKey;
let modelCalls: { url: string; init: RequestInit }[];
let modelReply: () => Response;
let imageCalls: { url: string; init: RequestInit }[];
let imageReply: () => Response;

beforeAll(async () => {
  const params = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  keys = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
  otherKeys = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
  publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
});

beforeEach(() => {
  resetAccessKeys();
  modelCalls = [];
  modelReply = () => Response.json({ choices: [{ message: { content: '{"explanation":"好"}' } }] });
  imageCalls = [];
  imageReply = () => Response.json({ steps: [{ type: "model_output", content: [{ type: "image", data: "AAAA", mime_type: "image/png" }] }] });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [{ ...publicJwk, kid: KID }] });
    if (url === GEMINI_URL) {
      imageCalls.push({ url, init });
      return imageReply();
    }
    if (url.startsWith(MODEL_URL)) {
      modelCalls.push({ url, init });
      return modelReply();
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

afterEach(() => vi.unstubAllGlobals());

function env(overrides: Partial<GameKitEnv> = {}): GameKitEnv {
  return {
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    ALLOW_GITHUB_USERS: ` ${ALLOWED.toUpperCase()} , other@example.com`,
    OPENAI_API_URL: `${MODEL_URL}/`,
    OPENAI_API_KEY: "server-secret",
    OPENAI_MODEL: "test-model",
    GEMINI_APIKEY: "gemini-secret",
    GEMINI_IMAGE_MODEL: "models/gemini-test-image",
    ...overrides,
  };
}

function b64url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function jwt(claims: Record<string, unknown> = {}, signer = keys.privateKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", kid: KID, typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, email: ALLOWED, iat: now, nbf: now, exp: now + 3600, ...claims }),
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

async function call(
  path: string,
  options: { token?: string; env?: GameKitEnv; init?: RequestInit; host?: string; cookie?: string } = {},
): Promise<Response> {
  const headers = new Headers(options.init?.headers);
  if (options.token) headers.set("Cf-Access-Jwt-Assertion", options.token);
  if (options.cookie) headers.set("Cookie", options.cookie);
  const request = new Request(`https://${options.host ?? "gamekit.talkincode.net"}${path}`, { ...options.init, headers });
  return worker.fetch(request as never, options.env ?? env(), {} as never);
}

const completion = {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ op: "complete", messages: [{ role: "user", content: "hi" }] }),
};

describe("identity gate", () => {
  it("refuses anonymous callers on every api route, known or not", async () => {
    for (const path of ["/api/me", "/api/ai", "/api/anything"]) {
      const response = await call(path, { init: path === "/api/ai" ? completion : undefined });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "sign_in_required" });
    }
    expect(modelCalls).toHaveLength(0);
  });

  it("lets an allowed account in, case-insensitively", async () => {
    const response = await call("/api/me", { token: await jwt({ email: "Kid@Example.com" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: ALLOWED });
  });

  it("refuses a valid Access sign-in that is not on the allowlist", async () => {
    const response = await call("/api/ai", { token: await jwt({ email: "stranger@example.com" }), init: completion });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "not_allowed" });
    expect(modelCalls).toHaveLength(0);
  });

  it("refuses tokens with the wrong signature, audience, issuer, expiry, or no email", async () => {
    const now = Math.floor(Date.now() / 1000);
    const bad = [
      await jwt({}, otherKeys.privateKey),
      await jwt({ aud: ["another-app"] }),
      await jwt({ iss: "https://evil.cloudflareaccess.com" }),
      await jwt({ exp: now - 120 }),
      await jwt({ nbf: now + 600 }),
      "not.a.jwt",
    ];
    for (const token of bad) {
      const response = await call("/api/me", { token });
      expect(response.status, token.slice(0, 40)).toBe(401);
    }
    const serviceToken = await call("/api/me", { token: await jwt({ email: undefined, common_name: "svc.access" }) });
    expect(serviceToken.status).toBe(403);
  });

  it("fails closed when Access or the allowlist is not configured", async () => {
    const token = await jwt();
    for (const overrides of [{ ACCESS_AUD: "" }, { ACCESS_TEAM_DOMAIN: "" }, { ALLOW_GITHUB_USERS: " , " }]) {
      const response = await call("/api/me", { token, env: env(overrides) });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "not_configured" });
    }
  });

  it("never honours the local sign-in outside localhost", async () => {
    const response = await call("/api/me", {
      env: env({ LOCAL_DEV_AUTH: "1" }),
      cookie: `gamekit_dev_email=${ALLOWED}`,
      token: await jwt(),
    });
    expect(response.status).toBe(503);
  });

  it("uses the local sign-in cookie on localhost, with the same allowlist", async () => {
    const local = env({ LOCAL_DEV_AUTH: "1", ACCESS_AUD: "" });
    const ok = await call("/api/me", { env: local, host: "localhost:5173", cookie: `gamekit_dev_email=${ALLOWED}` });
    expect(await ok.json()).toEqual({ email: ALLOWED });
    const denied = await call("/api/me", { env: local, host: "localhost:5173", cookie: "gamekit_dev_email=x@example.com" });
    expect(denied.status).toBe(403);
    const anonymous = await call("/api/me", { env: local, host: "localhost:5173" });
    expect(anonymous.status).toBe(401);
  });
});

describe("sign-in routes", () => {
  it("sends the browser back with the result of the sign-in", async () => {
    const ok = await call("/api/login", { token: await jwt() });
    expect(ok.status).toBe(302);
    expect(ok.headers.get("Location")).toBe("/?login=ok");
    const denied = await call("/api/login", { token: await jwt({ email: "stranger@example.com" }) });
    expect(denied.headers.get("Location")).toBe("/?login=denied");
    const unavailable = await call("/api/login", { token: await jwt(), env: env({ ACCESS_AUD: "" }) });
    expect(unavailable.headers.get("Location")).toBe("/?login=unavailable");
  });

  it("shows the local form, then signs in with the submitted email", async () => {
    const local = env({ LOCAL_DEV_AUTH: "1" });
    const form = await call("/api/login", { env: local, host: "localhost:5173" });
    expect(form.headers.get("Content-Type")).toContain("text/html");
    const submitted = await call("/api/login", {
      env: local,
      host: "localhost:5173",
      init: { method: "POST", body: new URLSearchParams({ email: ALLOWED }) },
    });
    expect(submitted.headers.get("Set-Cookie")).toContain(`gamekit_dev_email=${encodeURIComponent(ALLOWED)}`);
    const refused = await call("/api/login", { env: local, host: "localhost:5173", cookie: "gamekit_dev_email=x@example.com" });
    expect(refused.headers.get("Location")).toBe("/?login=denied");
    expect(refused.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("ends the Access session on sign-out", async () => {
    const response = await call("/api/logout");
    expect(response.headers.get("Location")).toBe("/cdn-cgi/access/logout");
  });
});

describe("ai gateway", () => {
  it("calls the configured model with the server-held key", async () => {
    const response = await call("/api/ai", { token: await jwt(), init: completion });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ text: '{"explanation":"好"}' });
    expect(body).not.toContain("server-secret");
    expect(modelCalls).toHaveLength(1);
    expect(modelCalls[0].url).toBe(`${MODEL_URL}/chat/completions`);
    expect(new Headers(modelCalls[0].init.headers).get("Authorization")).toBe("Bearer server-secret");
    expect(JSON.parse(String(modelCalls[0].init.body))).toMatchObject({ model: "test-model" });
  });

  it("reports a provider failure without echoing the provider's body", async () => {
    modelReply = () => new Response("invalid key server-secret", { status: 401 });
    const response = await call("/api/ai", { token: await jwt(), init: completion });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("server-secret");
  });

  it("refuses when the model is not configured", async () => {
    const response = await call("/api/ai", { token: await jwt(), init: completion, env: env({ OPENAI_API_KEY: "" }) });
    expect(response.status).toBe(503);
    expect(modelCalls).toHaveLength(0);
  });

  it("draws with Gemini: refined subject, child-safety rules, configured model", async () => {
    modelReply = () => Response.json({ choices: [{ message: { content: '{"prompt":"a cute cartoon fox"}' } }] });
    const response = await call("/api/ai", {
      token: await jwt(),
      init: { method: "POST", body: JSON.stringify({ op: "image", kind: "sprite", prompt: "小狐狸", variation: 2 }) },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ image: "AAAA", mediaType: "image/png" });

    expect(imageCalls).toHaveLength(1);
    expect(imageCalls[0].url).toBe(GEMINI_URL);
    const headers = new Headers(imageCalls[0].init.headers);
    expect(headers.get("x-goog-api-key")).toBe("gemini-secret");
    const body = JSON.parse(String(imageCalls[0].init.body)) as Record<string, unknown>;
    // The model comes from GEMINI_IMAGE_MODEL, and the child's words were refined first.
    expect(body.model).toBe("models/gemini-test-image");
    expect(String(body.input)).toContain("a cute cartoon fox");
    expect(String(body.input)).not.toContain("小狐狸");
    expect(String(modelCalls[0].init.body)).toContain("小狐狸");
    expect(body.response_modalities).toEqual(["image"]);
    expect(body.generation_config).toMatchObject({ image_config: { image_size: "1K" }, thinking_level: "minimal" });
  });

  it("tells the model what a sprite must not contain, and keeps the key server-side", async () => {
    await call("/api/ai", {
      token: await jwt(),
      init: { method: "POST", body: JSON.stringify({ op: "image", kind: "sprite", prompt: "小狐狸" }) },
    });
    const input = String((JSON.parse(String(imageCalls[0].init.body)) as { input: string }).input);
    expect(input).toContain("weapons");
    expect(input).toContain("watermarks");
    expect(input).toContain("more than one character");
    // Sprites and icons are drawn on a flat colour so the browser can cut it out.
    expect(input).toContain("FF00FF");
  });

  it("asks for no cutout background on tiles and backgrounds", async () => {
    for (const kind of ["tile", "background"]) {
      await call("/api/ai", {
        token: await jwt(),
        init: { method: "POST", body: JSON.stringify({ op: "image", kind, prompt: "夜晚的森林" }) },
      });
    }
    for (const call of imageCalls) {
      expect(String((JSON.parse(String(call.init.body)) as { input: string }).input)).not.toContain("FF00FF");
    }
  });

  it("refuses an unknown asset kind and an empty description", async () => {
    for (const body of [
      { op: "image", kind: "wallpaper", prompt: "x" },
      { op: "image", prompt: "小狐狸" },
      { op: "image", kind: "sprite", prompt: " " },
    ]) {
      const response = await call("/api/ai", {
        token: await jwt(),
        init: { method: "POST", body: JSON.stringify(body) },
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(imageCalls).toHaveLength(0);
    expect(modelCalls).toHaveLength(0);
  });

  it("refuses to draw when the Gemini key is not configured", async () => {
    const response = await call("/api/ai", {
      token: await jwt(),
      env: env({ GEMINI_APIKEY: "" }),
      init: { method: "POST", body: JSON.stringify({ op: "image", kind: "sprite", prompt: "小狐狸" }) },
    });
    expect(response.status).toBe(503);
    expect(imageCalls).toHaveLength(0);
  });

  it("reports a Gemini failure without echoing its body or the key", async () => {
    imageReply = () => new Response("bad key gemini-secret", { status: 403 });
    const response = await call("/api/ai", {
      token: await jwt(),
      init: { method: "POST", body: JSON.stringify({ op: "image", kind: "sprite", prompt: "小狐狸" }) },
    });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("gemini-secret");
  });

  it("answers 502 when the reply carries no image", async () => {
    imageReply = () => Response.json({ steps: [{ type: "model_output", content: [{ type: "text", text: "no" }] }] });
    const response = await call("/api/ai", {
      token: await jwt(),
      init: { method: "POST", body: JSON.stringify({ op: "image", kind: "sprite", prompt: "小狐狸" }) },
    });
    expect(response.status).toBe(502);
  });

  it("still draws when the text model cannot refine the description", async () => {
    modelReply = () => new Response("broken", { status: 500 });
    const response = await call("/api/ai", {
      token: await jwt(),
      init: { method: "POST", body: JSON.stringify({ op: "image", kind: "icon", prompt: "小星星" }) },
    });
    expect(response.status).toBe(200);
    const input = String((JSON.parse(String(imageCalls[0].init.body)) as { input: string }).input);
    expect(input).toContain("小星星");
  });

  it("passes attached pictures through to the model", async () => {
    const tiny = `data:image/jpeg;base64,${btoa("jpeg-bytes")}`;
    const response = await call("/api/ai", {
      token: await jwt(),
      init: {
        method: "POST",
        body: JSON.stringify({
          op: "complete",
          messages: [
            { role: "user", content: [{ type: "text", text: "看看这张图" }, { type: "image_url", image_url: { url: tiny } }] },
          ],
        }),
      },
    });
    expect(response.status).toBe(200);
    const sent = JSON.parse(String(modelCalls[0].init.body)) as { messages: { content: unknown }[] };
    expect(sent.messages[0].content).toEqual([
      { type: "text", text: "看看这张图" },
      { type: "image_url", image_url: { url: tiny } },
    ]);
  });

  it("refuses attachments that are not pictures, too many, or too big", async () => {
    const attempts = [
      [{ type: "image_url", image_url: { url: "https://example.com/x.png" } }],
      [{ type: "image_url", image_url: { url: "data:text/html;base64,AAAA" } }],
      [{ type: "file", file: { id: "1" } }],
      Array.from({ length: 5 }, () => ({ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } })),
      [{ type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(900_001)}` } }],
    ];
    for (const content of attempts) {
      const response = await call("/api/ai", {
        token: await jwt(),
        init: { method: "POST", body: JSON.stringify({ op: "complete", messages: [{ role: "user", content }] }) },
      });
      expect(response.status, JSON.stringify(content).slice(0, 60)).toBe(400);
    }
    expect(modelCalls).toHaveLength(0);
  });
});
