import type { GameKitEnv } from "./env";
import { HttpError } from "./http";

/**
 * The one identity gate for every `/api/*` route.
 *
 * Production: Cloudflare Access (GitHub identity provider) protects
 * `gamekit.talkincode.net/api` and injects `Cf-Access-Jwt-Assertion`. The Worker
 * still verifies that JWT itself (signature, audience, issuer, expiry) and checks
 * the email against ALLOW_GITHUB_USERS, so a misconfigured Access policy cannot
 * let anyone else in.
 *
 * Local development: with LOCAL_DEV_AUTH=1 on localhost, a cookie set by the
 * local sign-in form stands in for Access. The allowlist check is the same.
 *
 * Anything missing or unexpected is a refusal.
 */

export type Identity = { email: string };

export const DEV_COOKIE = "gamekit_dev_email";

export function allowlist(env: GameKitEnv): string[] {
  return (env.ALLOW_GITHUB_USERS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Whether this request is served by the local sign-in form instead of Access. */
export function usesLocalAuth(env: GameKitEnv, url: URL): boolean {
  if (env.LOCAL_DEV_AUTH !== "1") return false;
  if (!isLocalHost(url.hostname)) {
    throw new HttpError(503, "not_configured", "LOCAL_DEV_AUTH is set outside local development.");
  }
  return true;
}

export async function requireIdentity(request: Request, env: GameKitEnv, now = Date.now()): Promise<Identity> {
  const allowed = allowlist(env);
  if (!allowed.length) throw new HttpError(503, "not_configured", "No users are allowed to sign in yet.");

  const url = new URL(request.url);
  const email = usesLocalAuth(env, url) ? localEmail(request) : await accessEmail(request, env, now);
  if (!allowed.includes(email)) throw new HttpError(403, "not_allowed", "This account is not allowed to use GameKit.");
  return { email };
}

function localEmail(request: Request): string {
  const value = readCookie(request, DEV_COOKIE);
  if (!value) throw new HttpError(401, "sign_in_required", "Sign in first.");
  return value.trim().toLowerCase();
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cloudflare Access JWT
// ---------------------------------------------------------------------------

type Jwk = JsonWebKey & { kid?: string };

type AccessClaims = {
  aud?: string | string[];
  iss?: string;
  email?: string;
  exp?: number;
  nbf?: number;
};

const JWKS_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_S = 30;
let cachedKeys: { team: string; keys: Jwk[]; fetchedAt: number } | null = null;

/** Test hook. */
export function resetAccessKeys(): void {
  cachedKeys = null;
}

async function accessEmail(request: Request, env: GameKitEnv, now: number): Promise<string> {
  const team = env.ACCESS_TEAM_DOMAIN?.trim() ?? "";
  const aud = env.ACCESS_AUD?.trim() ?? "";
  if (!team || !aud) throw new HttpError(503, "not_configured", "Cloudflare Access is not set up yet.");

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new HttpError(401, "sign_in_required", "Sign in first.");

  const claims = await verifyAccessJwt(token, team, aud, now);
  if (typeof claims.email !== "string" || !claims.email.includes("@")) {
    // Service tokens carry no email. GameKit has no machine callers.
    throw new HttpError(403, "not_allowed", "This sign-in carries no account email.");
  }
  return claims.email.trim().toLowerCase();
}

export async function verifyAccessJwt(token: string, team: string, aud: string, now: number): Promise<AccessClaims> {
  const invalid = () => new HttpError(401, "sign_in_required", "The sign-in is not valid. Sign in again.");
  const parts = token.split(".");
  if (parts.length !== 3) throw invalid();
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJson<{ alg?: string; kid?: string }>(headerPart);
  if (!header || header.alg !== "RS256" || !header.kid) throw invalid();
  const signature = base64UrlToBytes(signaturePart);
  if (!signature) throw invalid();
  const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);

  let keys = await loadKeys(team, false, now);
  let ok = await verifyWith(keys, header.kid, signature, signed);
  if (!ok) {
    // Access rotates keys; retry once against a fresh set.
    keys = await loadKeys(team, true, now);
    ok = await verifyWith(keys, header.kid, signature, signed);
  }
  if (!ok) throw invalid();

  const claims = decodeJson<AccessClaims>(payloadPart);
  if (!claims) throw invalid();
  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!audiences.includes(aud)) throw invalid();
  if (claims.iss !== `https://${team}`) throw invalid();
  const seconds = now / 1000;
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < seconds) throw invalid();
  if (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_S > seconds) throw invalid();
  return claims;
}

async function loadKeys(team: string, force: boolean, now: number): Promise<Jwk[]> {
  const fresh = cachedKeys && cachedKeys.team === team && now - cachedKeys.fetchedAt < JWKS_TTL_MS;
  if (fresh && !force) return cachedKeys!.keys;
  const response = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!response.ok) throw new HttpError(503, "not_configured", `Cannot load Access keys (${response.status}).`);
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  if (!keys.length) throw new HttpError(503, "not_configured", "Access returned no signing keys.");
  cachedKeys = { team, keys, fetchedAt: now };
  return keys;
}

async function verifyWith(keys: Jwk[], kid: string, signature: Uint8Array, signed: Uint8Array): Promise<boolean> {
  const jwk = keys.find((candidate) => candidate.kid === kid);
  if (!jwk) return false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { ...jwk, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed);
  } catch {
    return false;
  }
}

function base64UrlToBytes(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function decodeJson<T>(segment: string): T | null {
  const bytes = base64UrlToBytes(segment);
  if (!bytes) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return value && typeof value === "object" ? (value as T) : null;
  } catch {
    return null;
  }
}
