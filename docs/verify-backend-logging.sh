#!/usr/bin/env bash
# HEL-1128: repeatable jar/image-level check that application (Flyway/startup)
# log lines actually reach stdout when the backend runs as its real Docker
# image, against a real Postgres — not `sbt run`, not a config-file-text
# assertion. The defect this guards against (an `<if>` in
# backend/src/main/resources/logback.xml silently leaving the root logger with
# no attached appender at runtime, despite Joran reporting a clean "End of
# configuration") is invisible to any check that only inspects source text or
# runs in-process: it only manifests in the assembled fat jar's runtime
# behavior inside the actual container. See design.md for the full local-repro
# transcript that found it.
#
# Round 2 (skeptic-final-1.md REFUTE) added the "unrecognized value" case: the
# round-1 fix (plain `${LOG_FORMAT:-plain}` property substitution) silently
# reintroduced the exact same appenderless-root defect for any value other
# than the literal string "json" (e.g. "JSON", "garbage") — this script now
# asserts BOTH LOG_FORMAT=json (structured JSON output) AND an unrecognized
# value (plain-text fallback output, never silence) so a future regression of
# either goes red.
#
# Usage: docs/verify-backend-logging.sh (run from the repo root)
# Requires: a working `docker` daemon.
set -euo pipefail

cd "$(dirname "$0")/.."

NET="hel1128-verify-net"
PG="hel1128-verify-pg"
IMAGE="hel1128-verify-backend"

cleanup() {
  docker rm -f "$APP_JSON" "$APP_UNRECOGNIZED" "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
APP_JSON="hel1128-verify-app-json"
APP_UNRECOGNIZED="hel1128-verify-app-unrecognized"
trap cleanup EXIT

cleanup
docker network create "$NET" >/dev/null

echo "Starting throwaway Postgres..."
docker run -d --rm --name "$PG" --network "$NET" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=helio postgres:16 >/dev/null

for i in $(seq 1 30); do
  if docker exec "$PG" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Building the real Dockerfile..."
docker build -t "$IMAGE" -f Dockerfile . >/dev/null

run_case() {
  local name="$1"
  local log_format_value="$2"
  local expect="$3" # "json" or "plain"

  echo ""
  echo "=== Case: LOG_FORMAT=${log_format_value:-<unset>} (expect $expect output) ==="

  local extra_env=()
  if [ -n "$log_format_value" ]; then
    extra_env=(-e "LOG_FORMAT=$log_format_value")
  fi

  docker run -d --name "$name" --network "$NET" \
    -e DATABASE_URL="jdbc:postgresql://$PG:5432/helio" \
    -e DB_USER=postgres \
    -e DB_PASSWORD=postgres \
    -e GOOGLE_CLIENT_ID=test-client-id \
    -e GOOGLE_CLIENT_SECRET=test-client-secret \
    -e GOOGLE_REDIRECT_URI=http://localhost:8080/api/auth/google/callback \
    -e COOKIE_SECURE=true \
    -e CORS_ALLOWED_ORIGINS=https://helioapp.dev \
    "${extra_env[@]}" \
    "$IMAGE" >/dev/null

  echo "Waiting for startup..."
  sleep 20

  local logs
  logs="$(docker logs "$name" 2>&1)"

  echo "----- captured stdout+stderr -----"
  echo "$logs"
  echo "-----------------------------------"

  local fail=0

  if ! grep -q 'up to date. No migration necessary\|Successfully applied' <<<"$logs"; then
    echo "FAIL [$name]: no Flyway line (\"Schema...up to date\"/\"Successfully applied\") found on stdout"
    fail=1
  fi

  if ! grep -q 'Helio backend listening on' <<<"$logs"; then
    echo "FAIL [$name]: no startup line (\"Helio backend listening on\") found on stdout"
    fail=1
  fi

  if [ "$expect" = "json" ]; then
    if ! grep -q '"severity":"INFO"' <<<"$logs"; then
      echo "FAIL [$name]: expected single-line JSON with a \"severity\" field, found none"
      fail=1
    fi
  else
    if grep -q '"severity":' <<<"$logs"; then
      echo "FAIL [$name]: expected plain-text fallback output, found structured JSON instead"
      fail=1
    fi
  fi

  return $fail
}

OVERALL_FAIL=0

run_case "$APP_JSON" "json" "json" || OVERALL_FAIL=1
run_case "$APP_UNRECOGNIZED" "garbage" "plain" || OVERALL_FAIL=1

if [ "$OVERALL_FAIL" -ne 0 ]; then
  echo ""
  echo "RESULT: FAIL — see FAIL lines above"
  exit 1
fi

echo ""
echo "RESULT: PASS — LOG_FORMAT=json produced structured JSON output, and an unrecognized LOG_FORMAT value (\"garbage\") fell back to plain-text output (not silence)"
