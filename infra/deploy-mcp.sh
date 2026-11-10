#!/usr/bin/env bash
set -euo pipefail

# Deploys helio-mcp (the MCP-over-HTTP connector endpoint, HEL-1709) as its own Cloud Run service.
# The owner runs this; the delivery lane that wrote it never does.
#
# Required environment (none is a secret; the one secret, the sealing key, comes from Secret Manager):
#   HELIO_API_BASE_URL   Base URL of the Helio backend the connector acts against.
# Optional environment:
#   HELIO_APP_URL                        Origin of the Helio web app (consent page). Default https://helioapp.dev
#   HELIO_MCP_PUBLIC_URL                 This service's public origin. Default https://mcp.helioapp.dev
#   HELIO_MCP_ALLOWED_REDIRECT_HOSTS     Comma-separated hosts a connector client may redirect to.
#                                        Default claude.ai,claude.com. Set to "" to allow any https host.
#   HELIO_MCP_LIVENESS_TTL_SECONDS       Default 300.
#
# Prerequisites (helio-mcp/README.md "Deploying"):
#   - service account helio-mcp-sa@helio-493120.iam.gserviceaccount.com
#   - Secret Manager secret helio-mcp-token-key (base64 of 32 random bytes), with
#     roles/secretmanager.secretAccessor granted to that service account
#   - for a rotation window only: secret helio-mcp-token-key-previous, and USE_PREVIOUS_KEY=1 here
#
# Billing is request-based (CPU throttled outside requests) and --min-instances=0: this must stay
# cheap. Never add the always-allocated-CPU flag (docs/deployment.md "Always-allocated CPU").
#
# Sizing (--memory, --concurrency, HELIO_MCP_LARGE_BODY_SLOTS) is from the recorded measurement in
# openspec/changes/helio-mcp-remote-oauth-connector/measurements.md; re-measure before changing.
#
# --max-instances=2 caps cost on a public endpoint. The per-IP auth limits and the used-code set are
# per instance, so effective limits are the configured ones x 2.
#
# "$@" forwards extra flags to the deploy command.

if ! grep -q -- '--image=' <<<"$*"; then
  echo "ERROR: deploy-mcp.sh requires an explicit --image=<full-image-path:tag> flag." >&2
  echo "Build and push the helio-mcp image first (docker build helio-mcp), then re-run:" >&2
  echo "  bash infra/deploy-mcp.sh --image=<full-image-path:tag>" >&2
  exit 1
fi

if [ -z "${HELIO_API_BASE_URL:-}" ]; then
  echo "ERROR: HELIO_API_BASE_URL is not set (the Helio backend the connector acts against)." >&2
  exit 1
fi

HELIO_APP_URL="${HELIO_APP_URL:-https://helioapp.dev}"
HELIO_MCP_PUBLIC_URL="${HELIO_MCP_PUBLIC_URL:-https://mcp.helioapp.dev}"
HELIO_MCP_ALLOWED_REDIRECT_HOSTS="${HELIO_MCP_ALLOWED_REDIRECT_HOSTS-claude.ai,claude.com}"
HELIO_MCP_LIVENESS_TTL_SECONDS="${HELIO_MCP_LIVENESS_TTL_SECONDS:-300}"

SECRETS="HELIO_MCP_TOKEN_KEY=helio-mcp-token-key:latest"
if [ "${USE_PREVIOUS_KEY:-}" = "1" ]; then
  SECRETS="${SECRETS},HELIO_MCP_TOKEN_KEY_PREVIOUS=helio-mcp-token-key-previous:latest"
fi

gcloud run deploy helio-mcp \
  --region=us-west1 \
  --platform=managed \
  --service-account=helio-mcp-sa@helio-493120.iam.gserviceaccount.com \
  --set-env-vars="^|^NODE_ENV=production|HELIO_MCP_PUBLIC_URL=${HELIO_MCP_PUBLIC_URL}|HELIO_APP_URL=${HELIO_APP_URL}|HELIO_API_BASE_URL=${HELIO_API_BASE_URL}|HELIO_MCP_ALLOWED_REDIRECT_HOSTS=${HELIO_MCP_ALLOWED_REDIRECT_HOSTS}|HELIO_MCP_LIVENESS_TTL_SECONDS=${HELIO_MCP_LIVENESS_TTL_SECONDS}|HELIO_MCP_LARGE_BODY_SLOTS=1" \
  --set-secrets="${SECRETS}" \
  --memory=1Gi \
  --cpu=1 \
  --concurrency=5 \
  --timeout=300 \
  --max-instances=2 \
  --min-instances=0 \
  --allow-unauthenticated \
  --project=helio-493120 \
  "$@"
