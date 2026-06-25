## Context

`infra/deploy-backend.sh` hard-codes environment-specific values directly in the `gcloud run deploy` command line. The current `--set-env-vars` flag includes:

- `GOOGLE_CLIENT_ID=522265251224-...` — OAuth Client ID (phishing vector)
- `GOOGLE_REDIRECT_URI=https://helioapp.dev/auth/callback` — env-specific URL
- `CORS_ALLOWED_ORIGINS=http://localhost:5173,...` — env-specific list of origins
- `DATABASE_URL` and `DB_USER` — already benign (infra references, not secrets)

The existing `--set-secrets` flag correctly handles `DB_PASSWORD` and `GOOGLE_CLIENT_SECRET` via Google Secret Manager. We extend that pattern.

`infra/README.md` exists but documents only a generic placeholder deploy command; it needs to describe the actual `deploy-backend.sh` workflow and its prerequisites.

## Goals / Non-Goals

**Goals:**
- Remove `GOOGLE_CLIENT_ID` from the committed script; source it from Secret Manager.
- Remove `GOOGLE_REDIRECT_URI` and `CORS_ALLOWED_ORIGINS` from the committed script; source them from a gitignored `infra/.env.deploy` file.
- Add `infra/.env.deploy.example` as a committed template.
- Update `infra/README.md` to document the prerequisites and usage of `deploy-backend.sh`.
- Add `infra/.env.deploy` to `.gitignore`.

**Non-Goals:**
- Removing GCP project/infra references (`helio-493120`, `us-west1`, service account) — these are structural references already exposed in other public artifacts.
- Migrating to Terraform or CI pipeline secrets.

## Decisions

### Decision 1: GOOGLE_CLIENT_ID via Secret Manager (`--set-secrets`)

**Rationale:** `DB_PASSWORD` and `GOOGLE_CLIENT_SECRET` already use `--set-secrets=VAR=secret-name:latest`. Extending this to `GOOGLE_CLIENT_ID` is the minimal-delta approach with zero new tooling. The operator must ensure a `helio-google-client-id` secret exists in Secret Manager before running the script — a one-time setup that can be automated later.

**Alternative considered:** Source from `.env.deploy` file. Rejected because the Client ID is best treated as a secret (consistent with Secret Manager being the source of truth for OAuth values), not a plain env file that might be copy-pasted carelessly.

### Decision 2: GOOGLE_REDIRECT_URI and CORS_ALLOWED_ORIGINS via `.env.deploy`

**Rationale:** These are environment configuration values, not secrets — they don't need to be encrypted at rest. An `.env.deploy` file sourced at deploy time (gitignored locally) is the simplest approach. The operator populates it once; the script sources it with `set -a; source infra/.env.deploy; set +a` before the gcloud invocation.

**Alternative considered:** Secret Manager for all three. Rejected — `GOOGLE_REDIRECT_URI` and `CORS_ALLOWED_ORIGINS` are not sensitive; Secret Manager is overkill and adds Secret Manager dependency for non-secret config.

### Decision 3: `.env.deploy.example` committed to the repo

Provides a template with placeholder values so new operators know exactly what to populate. Named `.example` so it is clearly not a real credentials file.

## Risks / Trade-offs

- New Secret Manager secret (`helio-google-client-id`) must be created before the script can run → documented in `infra/README.md`.
- Operator must create `infra/.env.deploy` locally before deploying → documented in `infra/README.md` with the `.env.deploy.example` template.
- `set -a; source` exposes all `.env.deploy` vars to subprocesses for the duration of the script — acceptable given the script is a short-lived operator tool.

## Migration Plan

1. Create Secret Manager secret `helio-google-client-id` with the OAuth Client ID value (one-time operator action).
2. Copy `infra/.env.deploy.example` to `infra/.env.deploy` and fill in values.
3. Run `infra/deploy-backend.sh` — no other change needed.

Rollback: If the script breaks, the previous hardcoded version is in git history and can be reverted in one commit.

## Planner Notes

Self-approved: this change removes an OAuth Client ID from a public repo and adds a `.env.deploy` file pattern. No breaking API change, no new external service (Secret Manager was already in use for `DB_PASSWORD`/`GOOGLE_CLIENT_SECRET`). Scope is entirely within `infra/` and `.gitignore`/`README.md`. No escalation warranted.
