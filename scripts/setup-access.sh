#!/usr/bin/env bash
#
# Put gamekit.talkincode.net/api behind Cloudflare Access (GitHub sign-in only)
# and write the application's AUD tag into wrangler.jsonc.
#
# Safe to run again: existing objects are reused and brought up to date.
#
# Needs an API token (https://dash.cloudflare.com/profile/api-tokens) with:
#   Account → Access: Apps and Policies → Edit
#   Account → Access: Organizations, Identity Providers, and Groups → Read
#
# Usage:
#   CLOUDFLARE_API_TOKEN=... ./scripts/setup-access.sh
#
# The allowlist comes from ALLOW_GITHUB_USERS in .env (or $ENV_FILE); never printed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-83b40c9065a6f4631f4ab6cda824a21a}"
ZONE_NAME="${ZONE_NAME:-talkincode.net}"
APP_HOST="${APP_HOST:-gamekit.talkincode.net}"
APP_NAME="${APP_NAME:-GameKit}"
API="https://api.cloudflare.com/client/v4"

fail() { echo "error: $1" >&2; exit 1; }

[[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || fail "CLOUDFLARE_API_TOKEN is not set (see the header of this script)."

ENV_FILE="${ENV_FILE:-$ROOT/.env}"
if [[ -z "${ALLOW_GITHUB_USERS:-}" && -f "$ENV_FILE" ]]; then
  ALLOW_GITHUB_USERS="$(sed -n 's/^ALLOW_GITHUB_USERS=//p' "$ENV_FILE" | tr -d '"'"'"' ')"
fi
[[ -n "${ALLOW_GITHUB_USERS:-}" ]] || fail "ALLOW_GITHUB_USERS is empty (set it in .env)."
export ALLOW_GITHUB_USERS

# api METHOD PATH [JSON]  → prints .result as JSON, fails loudly otherwise.
api() {
  local method="$1" path="$2" body="${3:-}" response
  if [[ -n "$body" ]]; then
    response="$(curl -sS -X "$method" "$API$path" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" --data "$body")"
  else
    response="$(curl -sS -X "$method" "$API$path" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")"
  fi
  printf '%s' "$response" | python3 -c '
import json, sys
payload = json.load(sys.stdin)
if not payload.get("success"):
    sys.exit("Cloudflare API: " + json.dumps(payload.get("errors")))
print(json.dumps(payload.get("result")))
'
}

pick() { python3 -c "import json,sys; $1"; }

echo "==> Zero Trust organisation"
TEAM_DOMAIN="$(api GET "/accounts/$ACCOUNT_ID/access/organizations" | pick 'print(json.load(sys.stdin)["auth_domain"])')" \
  || fail "cannot read the Zero Trust organisation (is the token scoped to Access?)"
echo "    team domain: $TEAM_DOMAIN"

echo "==> GitHub identity provider"
GITHUB_IDP="$(api GET "/accounts/$ACCOUNT_ID/access/identity_providers?per_page=100" | pick '
for idp in json.load(sys.stdin) or []:
    if idp.get("type") == "github":
        print(idp["id"]); break
')"
if [[ -z "$GITHUB_IDP" ]]; then
  cat >&2 <<MSG
error: this Zero Trust organisation has no GitHub identity provider yet.

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth app
     Homepage URL:               https://$TEAM_DOMAIN
     Authorization callback URL: https://$TEAM_DOMAIN/cdn-cgi/access/callback
2. Cloudflare dashboard → Zero Trust → Integrations → Identity providers → Add → GitHub,
   paste the Client ID and a new Client secret, save, then "Test".
3. Run this script again.
MSG
  exit 1
fi
echo "    $GITHUB_IDP"

APP_BODY="$(python3 -c '
import json, sys
host, name, zone, idp = sys.argv[1:5]
print(json.dumps({
    "name": name,
    # Only /api is protected. The studio page and PWA shell stay public.
    # The path must be part of "domain"; a separate "path" field is dropped.
    "domain": host + "/api",
    "type": "self_hosted",
    "zone_name": zone,
    "session_duration": "168h",
    "allowed_idps": [idp],
    "auto_redirect_to_identity": True,
    "app_launcher_visible": False,
    "http_only_cookie_attribute": True,
    "same_site_cookie_attribute": "lax",
}))
' "$APP_HOST" "$APP_NAME" "$ZONE_NAME" "$GITHUB_IDP")"

echo "==> Access application $APP_HOST/api"
APP_ID="$(api GET "/accounts/$ACCOUNT_ID/access/apps?per_page=100" | APP_NAME="$APP_NAME" pick '
import os
for app in json.load(sys.stdin) or []:
    if app.get("name") == os.environ["APP_NAME"]:
        print(app["id"]); break
')"
if [[ -z "$APP_ID" ]]; then
  APP_ID="$(api POST "/accounts/$ACCOUNT_ID/access/apps" "$APP_BODY" | pick 'print(json.load(sys.stdin)["id"])')"
  echo "    created $APP_ID"
else
  api PUT "/accounts/$ACCOUNT_ID/access/apps/$APP_ID" "$APP_BODY" >/dev/null
  echo "    updated $APP_ID"
fi
AUD="$(api GET "/accounts/$ACCOUNT_ID/access/apps/$APP_ID" | pick 'print(json.load(sys.stdin)["aud"])')"

echo "==> allow policy (emails from ALLOW_GITHUB_USERS)"
POLICY_BODY="$(python3 -c '
import json, os
emails = [e.strip() for e in os.environ["ALLOW_GITHUB_USERS"].split(",") if e.strip()]
print(json.dumps({
    "name": "allow-gamekit-users",
    "decision": "allow",
    "include": [{"email": {"email": e}} for e in emails],
}))
')"
POLICY_ID="$(api GET "/accounts/$ACCOUNT_ID/access/apps/$APP_ID/policies" | pick '
for policy in json.load(sys.stdin) or []:
    if policy.get("name") == "allow-gamekit-users":
        print(policy["id"]); break
')"
if [[ -z "$POLICY_ID" ]]; then
  api POST "/accounts/$ACCOUNT_ID/access/apps/$APP_ID/policies" "$POLICY_BODY" >/dev/null
  echo "    created"
else
  api PUT "/accounts/$ACCOUNT_ID/access/apps/$APP_ID/policies/$POLICY_ID" "$POLICY_BODY" >/dev/null
  echo "    updated"
fi

echo "==> wrangler.jsonc"
python3 - "$ROOT/wrangler.jsonc" "$TEAM_DOMAIN" "$AUD" <<'PY'
import re, sys
path, team, aud = sys.argv[1:4]
source = open(path, encoding="utf-8").read()
for key, value in (("ACCESS_TEAM_DOMAIN", team), ("ACCESS_AUD", aud)):
    source, count = re.subn(r'("%s"\s*:\s*)"[^"]*"' % key, r'\g<1>"%s"' % value, source)
    if count != 1:
        sys.exit("could not find %s in wrangler.jsonc" % key)
open(path, "w", encoding="utf-8").write(source)
print("    ACCESS_TEAM_DOMAIN and ACCESS_AUD written")
PY

cat <<MSG

==> done. Next:
  ./scripts/put-secrets.sh     # ALLOW_GITHUB_USERS, OPENAI_API_URL, OPENAI_API_KEY → Worker secrets
  commit wrangler.jsonc and push to main (CI deploys)
MSG
