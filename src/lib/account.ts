/**
 * Sign-in state as the page sees it.
 *
 * The page never asks the server who you are unless you signed in on this device
 * before (the hint below). That keeps the anonymous path free of identity
 * requests, and works offline.
 *
 * In production `/api/*` sits behind Cloudflare Access: a missing or expired
 * session answers with a redirect to the Access login page instead of JSON.
 * All API calls therefore use `redirect: "manual"` and treat a redirect as
 * "sign in again".
 */

export type Account =
  | { kind: "checking" }
  | { kind: "anonymous"; note?: SignInNote }
  | { kind: "signed-in"; email: string }
  /** Signed in before, but the server cannot be asked right now. */
  | { kind: "unreachable"; reason: "offline" | "unavailable" };

/** One-time explanation shown after a sign-in attempt or a lost session. */
export type SignInNote = "denied" | "failed" | "expired" | "unavailable" | "signed-out";

export type ApiOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; problem: "sign-in" | "denied" | "unavailable" | "offline" | "error"; message: string };

const HINT_KEY = "gamekit.signedIn";

export const LOGIN_PATH = "/api/login";
export const LOGOUT_PATH = "/api/logout";

export function hasSignInHint(): boolean {
  return localStorage.getItem(HINT_KEY) === "1";
}

export function setSignInHint(on: boolean): void {
  if (on) localStorage.setItem(HINT_KEY, "1");
  else localStorage.removeItem(HINT_KEY);
}

/**
 * Reads and removes `?login=<result>` left by `/api/login` and `/api/logout`.
 * Returns what the page should do next.
 */
export function takeLoginResult(): "ok" | SignInNote | null {
  const url = new URL(location.href);
  const value = url.searchParams.get("login");
  if (!value) return null;
  url.searchParams.delete("login");
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  if (value === "ok") return "ok";
  if (value === "out") return "signed-out";
  if (value === "denied" || value === "failed" || value === "unavailable") return value;
  return null;
}

export async function callApi<T>(path: string, init: RequestInit = {}): Promise<ApiOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: "same-origin", redirect: "manual" });
  } catch {
    return { ok: false, problem: "offline", message: "The network request failed." };
  }
  // Cloudflare Access redirects to its login page when the session is missing.
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    return { ok: false, problem: "sign-in", message: "Sign in again." };
  }
  let payload: { error?: string; code?: string } & Record<string, unknown> = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    // A non-JSON answer is handled by the status checks below.
  }
  const message = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
  if (response.ok) return { ok: true, value: payload as T };
  if (response.status === 401) return { ok: false, problem: "sign-in", message };
  if (response.status === 403) return { ok: false, problem: "denied", message };
  if (response.status === 503) return { ok: false, problem: "unavailable", message };
  return { ok: false, problem: "error", message };
}

/** Asks the server who is signed in. Only call this when there is a sign-in hint. */
export async function fetchAccount(): Promise<Account> {
  const outcome = await callApi<{ email?: string }>("/api/me");
  if (outcome.ok && typeof outcome.value.email === "string") return { kind: "signed-in", email: outcome.value.email };
  if (outcome.ok) return { kind: "anonymous", note: "failed" };
  if (outcome.problem === "offline") return { kind: "unreachable", reason: "offline" };
  if (outcome.problem === "unavailable") return { kind: "unreachable", reason: "unavailable" };
  if (outcome.problem === "denied") return { kind: "anonymous", note: "denied" };
  if (outcome.problem === "sign-in") return { kind: "anonymous", note: "expired" };
  return { kind: "unreachable", reason: "unavailable" };
}
