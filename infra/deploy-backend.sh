#!/usr/bin/env bash
set -euo pipefail

# Load environment-specific configuration (GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI,
# CORS_ALLOWED_ORIGINS). Copy infra/.env.deploy.example to infra/.env.deploy and fill in your
# values.
set -a; source "$(dirname "$0")/.env.deploy"; set +a

# COOKIE_SECURE=true is hardcoded below (not sourced from .env.deploy): this deploy target is
# always a cross-site prod topology (Firebase Hosting frontend / Cloud Run backend, no reverse
# proxy), where the session cookie requires Secure + SameSite=None to be set at all (see
# CookieConfig.scala / design.md D1, HEL-287). It is never operator-configurable.

# HEL-703: HELIO_BETA_DAILY_MESSAGE_LIMIT is optional in .env.deploy (UserTierConfig already
# falls back to its own default of 50 when the env var is unset) — defaulted here only so this
# script never emits a literal empty value into --set-env-vars.
HELIO_BETA_DAILY_MESSAGE_LIMIT="${HELIO_BETA_DAILY_MESSAGE_LIMIT:-50}"

# HEL-749 cycle 3: --max-instances=2 (not 3) matches the live, intentionally-set production
# value — commit 51f110c0 ("Pin production CLAUDE_MODEL to Haiku 4.5 and cap Cloud Run to 2
# instances") capped it after the privileged DB pool (5 connections/instance,
# helio.db.privileged.maximumPoolSize in application.conf) exhausted db-g1-small's connection
# budget with 3+ concurrent instances, causing intermittent SQLTransientConnectionException on
# /converse. This capacity constraint is about total connection demand, not the DB transport
# mechanism this ticket changes (socketFactory vs. private-IP/VPC-connector), so it remains just
# as necessary after this migration as before it — do not raise this without a fresh, explicit
# capacity decision (Non-Goals reserves that for HEL-751/HEL-752).
#
# HEL-749 cycle 2: HELIO_UPLOADS_BACKEND, HELIO_UPLOADS_BUCKET, and CLAUDE_MODEL are hardcoded
# literals below (not sourced from .env.deploy) because, unlike GOOGLE_CLIENT_ID/
# GOOGLE_REDIRECT_URI/CORS_ALLOWED_ORIGINS, they are stable, non-environment-specific production
# values — confirmed against the live service (`gcloud run services describe helio-backend`)
# rather than assumed, since this script's --set-env-vars/--set-secrets fully REPLACE the Cloud
# Run revision's env vars on every deploy (anything omitted here is silently dropped, not merged).
# GOOGLE_CLIENT_ID must be a plain env var, not a --set-secrets entry: the
# `helio-google-client-id` Secret Manager secret this script referenced does not exist
# (`gcloud secrets describe helio-google-client-id` → NOT_FOUND); the live service actually runs
# with GOOGLE_CLIENT_ID as a plain env var.
#
# HEL-749 cycle 4: GOOGLE_CLIENT_ID is sourced from .env.deploy (variable reference below), not
# hardcoded as a literal in --set-env-vars — cycle 2's literal violated the pre-existing,
# still-binding openspec requirement "deploy-backend.sh contains no hardcoded
# environment-specific identifiers" (openspec/specs/production-deployment-docs/spec.md). An OAuth
# Client ID is not confidential (it's a public identifier, which is why it's still a plain env
# var rather than a Secret Manager entry), but it IS environment-specific config, so it follows
# the same .env.deploy-sourced pattern as GOOGLE_REDIRECT_URI/CORS_ALLOWED_ORIGINS below.

# HEL-749: DB connectivity moved from the postgres-socket-factory connector library
# (--add-cloudsql-instances + a socketFactory DATABASE_URL) to a Serverless VPC Access
# connector + Cloud SQL Private IP — Google's recommended prod Cloud Run -> Cloud SQL
# setup, which removes the connector library's per-connection TLS-handshake/ephemeral-
# cert-fetch dance (the confirmed failure point behind HEL-696 and its recurrence) from
# the request path. --add-cloudsql-instances is removed cleanly rather than gated behind
# a flag: this script only affects the *new* revision it deploys, so a rollback to the
# old connectivity path (if ever needed) means redeploying an already-existing prior
# Cloud Run revision (see design.md Decision 4 / tasks.md 7.4), not re-invoking this
# script with a different flag combination. Keeping a dead connector path alive here
# would be extra surface with no real fallback value. DATABASE_URL's private IP
# (10.8.0.3) requires ?sslmode=require: helio-db's sslMode is ENCRYPTED_ONLY, and pgjdbc
# does not enable SSL by default (design.md Decision 4a).
#
# "$@" (HEL-749 design.md Decision 4c): forwards any extra flags to `gcloud run deploy`,
# e.g. `./infra/deploy-backend.sh --no-traffic` for a zero-traffic cutover deploy. Empty
# by default, so ordinary invocations behave exactly as before.
#
# HEL-753: this script no longer hardcodes an --image= tag (the old hardcoded ":v3" tag
# went stale and, if ever deployed as-is, would silently downgrade production to a
# materially older build — see HEL-749's cutover, which had to override it explicitly).
# The caller MUST now pass --image=<full-image-path:tag> via "$@" (design.md Decision D1);
# this guard fails fast, before invoking gcloud, if that flag is missing.
if ! grep -q -- '--image=' <<<"$*"; then
  echo "ERROR: deploy-backend.sh requires an explicit --image=<full-image-path:tag> flag." >&2
  echo "This script no longer defaults to any image tag (HEL-753) — deploying without one" >&2
  echo "would previously have silently redeployed a stale, hardcoded build." >&2
  echo "" >&2
  echo "To find the currently-live tag:" >&2
  echo "  gcloud run services describe helio-backend --region=us-west1 --project=helio-493120 \\" >&2
  echo "    --format='value(spec.template.spec.containers[0].image)'" >&2
  echo "" >&2
  echo "To find a CI-built tag for a specific commit, see the matching run of" >&2
  echo ".github/workflows/cd-backend.yml (triggered on push to release/**) — its" >&2
  echo "\"Build and push image\" step logs the pushed tag (convention: <branch>-<8-char-sha>)." >&2
  echo "" >&2
  echo "Then re-run with the tag you found:" >&2
  echo "  bash infra/deploy-backend.sh --image=<full-image-path-from-above>" >&2
  exit 1
fi

gcloud run deploy helio-backend \
  --region=us-west1 \
  --platform=managed \
  --vpc-connector=helio-vpc-connector \
  --vpc-egress=private-ranges-only \
  --service-account=helio-backend-sa@helio-493120.iam.gserviceaccount.com \
  --set-env-vars="^|^DATABASE_URL=jdbc:postgresql://10.8.0.3:5432/helio?sslmode=require|DB_USER=helio|GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}|GOOGLE_REDIRECT_URI=${GOOGLE_REDIRECT_URI}|CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS}|COOKIE_SECURE=true|LOG_FORMAT=json|HELIO_OWNER_EMAILS=${HELIO_OWNER_EMAILS}|HELIO_BETA_DAILY_MESSAGE_LIMIT=${HELIO_BETA_DAILY_MESSAGE_LIMIT}|HELIO_UPLOADS_BACKEND=gcs|HELIO_UPLOADS_BUCKET=helio-uploads-prod|CLAUDE_MODEL=claude-haiku-4-5-20251001" \
  --set-secrets=DB_PASSWORD=helio-db-password:latest,GOOGLE_CLIENT_SECRET=helio-google-client-secret:latest,ANTHROPIC_API_KEY=helio-anthropic-api-key:latest \
  --memory=1Gi \
  --cpu=1 \
  --concurrency=80 \
  --max-instances=2 \
  --min-instances=0 \
  --allow-unauthenticated \
  --project=helio-493120 \
  "$@"
