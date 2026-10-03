#!/usr/bin/env bash
#
# Copy the server-side secrets from .env into the production Worker.
# Values are piped to wrangler and never printed.
#
# Usage: ./scripts/put-secrets.sh   (needs `wrangler login` or CLOUDFLARE_API_TOKEN)
#        ENV_FILE=/path/to/.env ./scripts/put-secrets.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
[[ -f "$ENV_FILE" ]] || { echo "error: $ENV_FILE not found" >&2; exit 1; }

for name in ALLOW_GITHUB_USERS OPENAI_API_URL OPENAI_API_KEY GEMINI_APIKEY; do
  value="$(sed -n "s/^${name}=//p" "$ENV_FILE" | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//')"
  if [[ -z "$value" ]]; then
    echo "error: $name is empty in .env" >&2
    exit 1
  fi
  printf '%s' "$value" | (cd "$ROOT" && pnpm exec wrangler secret put "$name")
done

# Optional: which Gemini image model to draw with. Missing means the Worker's
# built-in default, so an empty value here is fine.
value="$(sed -n "s/^GEMINI_IMAGE_MODEL=//p" "$ENV_FILE" | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//')"
if [[ -n "$value" ]]; then
  printf '%s' "$value" | (cd "$ROOT" && pnpm exec wrangler secret put GEMINI_IMAGE_MODEL)
else
  echo "note: GEMINI_IMAGE_MODEL is not set in .env; keeping the Worker default" >&2
fi
