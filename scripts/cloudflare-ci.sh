#!/usr/bin/env bash
set -Eeuo pipefail

log() { printf '\n==> %s\n' "$*"; }
fail() { echo "::error::$*"; exit 1; }

log "Normalize Cloudflare API token"
RAW_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
[[ -n "$RAW_TOKEN" ]] || fail "Missing GitHub Actions secret: CLOUDFLARE_API_TOKEN"

NORMALIZED_TOKEN=$(python - <<'PY'
import os, re
raw = os.environ.get('CLOUDFLARE_API_TOKEN', '')
s = raw.strip().replace('\r', '').replace('\n', '')
for _ in range(3):
    old = s
    s = re.sub(r'^\s*CLOUDFLARE_API_TOKEN\s*=\s*', '', s, flags=re.I)
    s = re.sub(r'^\s*Authorization\s*:\s*Bearer\s+', '', s, flags=re.I)
    s = re.sub(r'^\s*Bearer\s+', '', s, flags=re.I)
    s = s.strip().strip('"\'').strip()
    if s == old:
        break
# Cloudflare token values are 40-80 characters. Current credentials may use
# scannable prefixes/checksums, so only reject whitespace/control characters.
def valid(value):
    return 40 <= len(value) <= 80 and not re.search(r'\s', value)
if not valid(s):
    candidates = [x for x in re.findall(r'[^\s"\']{40,80}', raw) if valid(x)]
    if len(candidates) == 1:
        s = candidates[0]
print(s if valid(s) else 'INVALID', end='')
PY
)
[[ "$NORMALIZED_TOKEN" != "INVALID" ]] || fail "CLOUDFLARE_API_TOKEN is not a valid Cloudflare API token after normalization."
export CLOUDFLARE_API_TOKEN="$NORMALIZED_TOKEN"
echo "::add-mask::$CLOUDFLARE_API_TOKEN"
unset RAW_TOKEN NORMALIZED_TOKEN

log "Install deployment dependencies"
npm install

log "Resolve Cloudflare account"
if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  set +e
  npx wrangler whoami --json > /tmp/whoami.json 2> /tmp/whoami.err
  WHOAMI_STATUS=$?
  set -e
  if [[ "$WHOAMI_STATUS" -ne 0 ]]; then
    cat /tmp/whoami.err || true
    fail "Cloudflare token authentication failed. The secret must contain the raw API token value and the token must permit account membership lookup."
  fi

  CLOUDFLARE_ACCOUNT_ID=$(python - <<'PY'
import json, re
from pathlib import Path

data = json.loads(Path('/tmp/whoami.json').read_text(encoding='utf-8'))
accounts = data.get('accounts') or []
if isinstance(accounts, dict):
    accounts = [accounts]
candidates = []
for account in accounts:
    if not isinstance(account, dict):
        continue
    value = account.get('id') or account.get('account_id') or account.get('accountId')
    if isinstance(value, str) and re.fullmatch(r'[0-9a-fA-F]{32}', value):
        candidates.append((value.lower(), str(account.get('name') or 'Cloudflare account')))
unique = []
seen = set()
for value, name in candidates:
    if value not in seen:
        seen.add(value)
        unique.append((value, name))
if len(unique) == 1:
    print(unique[0][0], end='')
elif len(unique) == 0:
    print('ERROR:no_account', end='')
else:
    print('ERROR:multiple_accounts:' + ','.join(f'{name}={value}' for value, name in unique), end='')
PY
)
  case "$CLOUDFLARE_ACCOUNT_ID" in
    ERROR:no_account) fail "Wrangler authenticated but returned no Cloudflare account." ;;
    ERROR:multiple_accounts:*) fail "Multiple Cloudflare accounts are available: ${CLOUDFLARE_ACCOUNT_ID#ERROR:multiple_accounts:}. Set CLOUDFLARE_ACCOUNT_ID once to select the target safely." ;;
  esac
fi
export CLOUDFLARE_ACCOUNT_ID
echo "Resolved Cloudflare Account ID: $CLOUDFLARE_ACCOUNT_ID"

log "Generate and validate Worker"
npm run generate:config
npm run check:syntax
npx wrangler whoami --account "$CLOUDFLARE_ACCOUNT_ID"
npx wrangler deploy --dry-run

log "Deploy Worker and auto-provision resources"
rm -f /tmp/wrangler-output.jsonl /tmp/wrangler-deploy.log
WRANGLER_OUTPUT_FILE_PATH=/tmp/wrangler-output.jsonl npx wrangler deploy 2>&1 | tee /tmp/wrangler-deploy.log
WORKER_URL=$(python - <<'PY'
import json
from pathlib import Path
path = Path('/tmp/wrangler-output.jsonl')
if path.exists():
    for raw in path.read_text(encoding='utf-8', errors='replace').splitlines():
        try:
            item = json.loads(raw)
        except Exception:
            continue
        if item.get('type') == 'deploy':
            for target in item.get('targets') or []:
                if isinstance(target, str) and target.startswith('https://'):
                    print(target.rstrip('/'), end='')
                    raise SystemExit
PY
)
if [[ -z "$WORKER_URL" ]]; then
  WORKER_URL=$(grep -Eo 'https://[^ ]+\.workers\.dev[^ ]*' /tmp/wrangler-deploy.log | tail -1 | sed 's/[[:punct:]]$//' || true)
fi
[[ -n "$WORKER_URL" ]] || fail "Worker deployed but its public URL could not be determined."
export WORKER_URL
echo "Production Worker: $WORKER_URL"

log "Apply D1 migrations"
npx wrangler d1 migrations apply DB --remote

log "Rotate refresh administration secret"
ADMIN_TOKEN=$(openssl rand -hex 32)
export ADMIN_TOKEN
printf '%s' "$ADMIN_TOKEN" | npx wrangler secret put ADMIN_TOKEN

log "Verify D1 health"
HEALTH_OK=0
for attempt in 1 2 3 4 5; do
  BODY=$(curl --fail --silent --show-error "$WORKER_URL/api/health" || true)
  if [[ -n "$BODY" ]]; then
    export BODY
    if python - <<'PY'
import json, os, sys
try:
    data = json.loads(os.environ['BODY'])
except Exception:
    sys.exit(1)
print(json.dumps(data, ensure_ascii=False))
sys.exit(0 if data.get('ok') is True and str(data.get('schema_version')) == '2' else 1)
PY
    then
      HEALTH_OK=1
      break
    fi
  fi
  sleep 3
done
[[ "$HEALTH_OK" -eq 1 ]] || fail "Worker is deployed but D1 health/schema v2 validation failed."

log "Run production refresh"
curl --fail --silent --show-error --max-time 240 \
  -X POST "$WORKER_URL/api/refresh" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -o /tmp/refresh.json
python - <<'PY'
import json
print(json.dumps(json.load(open('/tmp/refresh.json', encoding='utf-8')), ensure_ascii=False, indent=2))
PY

log "Audit four-firm D1 coverage"
curl --fail --silent --show-error "$WORKER_URL/api/coverage" -o /tmp/coverage.json
python - <<'PY'
import json
print(json.dumps(json.load(open('/tmp/coverage.json', encoding='utf-8')), ensure_ascii=False, indent=2))
PY

log "Sync D1 snapshots and production URL"
mkdir -p data
curl --fail --silent --show-error "$WORKER_URL/api/export.json" -o data/reports.json
curl --fail --silent --show-error "$WORKER_URL/api/export.csv" -o data/reports.csv
python - <<'PY'
import os, re
from pathlib import Path
path = Path('README.md')
text = path.read_text(encoding='utf-8')
url = os.environ['WORKER_URL']
block = f"<!-- PRODUCTION_URL_START -->\n**Production:** {url}\n\n**GitHub Pages fallback:** https://linwuyen.github.io/Consultant_System/\n<!-- PRODUCTION_URL_END -->"
pattern = r'<!-- PRODUCTION_URL_START -->[\s\S]*?<!-- PRODUCTION_URL_END -->'
if re.search(pattern, text):
    text = re.sub(pattern, block, text)
else:
    marker = '## Website\n'
    text = text.replace(marker, marker + '\n' + block + '\n', 1) if marker in text else block + '\n\n' + text
path.write_text(text, encoding='utf-8')
PY

log "Commit persistent production identifiers and fallback snapshot"
if ! git diff --quiet -- data/reports.json data/reports.csv README.md wrangler.jsonc; then
  git config user.name "consultant-system-bot"
  git config user.email "consultant-system-bot@users.noreply.github.com"
  git add data/reports.json data/reports.csv README.md wrangler.jsonc
  git commit -m "chore: sync D1 production snapshot"
  git push
else
  echo "No production snapshot changes"
fi

log "Enforce final coverage gate"
python - <<'PY'
import json, sys
data = json.load(open('/tmp/coverage.json', encoding='utf-8'))
failures = [x['company'] for x in data.get('companies', []) if x.get('status') == 'FAIL']
partial = [x['company'] for x in data.get('companies', []) if x.get('status') == 'PARTIAL']
if partial:
    print('Coverage PARTIAL:', ', '.join(partial))
if failures:
    print('Coverage FAIL:', ', '.join(failures))
    sys.exit(1)
print('Coverage gate PASS/PARTIAL: no company is at FAIL.')
PY
