/**
 * Everything the Worker reads from its environment.
 *
 * Vars (not secret) live in wrangler.jsonc; secrets come from `wrangler secret put`
 * in production and from the git-ignored `.env` / `.dev.vars` locally.
 * A missing value never widens access: see identity.ts and ai.ts.
 */
export type GameKitEnv = {
  /** Workers AI binding, used for image generation. */
  AI?: Ai;
  /** Zero Trust team domain, e.g. `<team>.cloudflareaccess.com`. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Audience tag of the GameKit Access application. */
  ACCESS_AUD?: string;
  /** Comma-separated GitHub account emails that may sign in. */
  ALLOW_GITHUB_USERS?: string;
  /** Base URL of an OpenAI-compatible API (without `/chat/completions`). */
  OPENAI_API_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  /**
   * Local development only: `1` replaces Cloudflare Access with a sign-in form.
   * It is honoured only on localhost; anywhere else it makes identity routes fail.
   */
  LOCAL_DEV_AUTH?: string;
};
