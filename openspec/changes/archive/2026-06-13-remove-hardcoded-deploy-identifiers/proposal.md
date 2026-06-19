## Why

`deploy-backend.sh` is committed to a public GitHub repo and hardcodes `GOOGLE_CLIENT_ID` (and other environment-specific values) directly in the `--set-env-vars` flag. OAuth Client IDs in public source are a phishing vector. Keeping all environment-specific identifiers out of the committed script is good security hygiene and aligns with the pattern already used for `DB_PASSWORD` and `GOOGLE_CLIENT_SECRET` via `--set-secrets`.

## What Changes

- Move `GOOGLE_CLIENT_ID` from `--set-env-vars` to `--set-secrets` (referencing Google Secret Manager), extending the existing pattern.
- Move `GOOGLE_REDIRECT_URI` and `CORS_ALLOWED_ORIGINS` from hardcoded values in `--set-env-vars` to variables sourced from a gitignored `.env.deploy` file at deploy time, since these are environment-specific but not secrets.
- The infrastructure references (`DATABASE_URL`, `--add-cloudsql-instances`, `--service-account`, `--image`, `--project`) are structural — they identify the GCP project and are visible in other public artifacts (Dockerfiles, gcloud configs). They are **not** the phishing-vector concern and are left as-is per ticket scope.
- Add `.env.deploy.example` template so operators know what to populate.
- Update README.md (production-deployment-docs) to document the `.env.deploy` requirement and what Secret Manager entries are needed to run the script.

## Capabilities

### New Capabilities
- None — this is a deploy-script hygiene change with no new API or app capabilities.

### Modified Capabilities
- `production-deployment-docs`: README documentation requirements expand to cover the `.env.deploy` file and Secret Manager prerequisites for running `deploy-backend.sh`.

## Impact

- `infra/deploy-backend.sh` — modified to remove hardcoded `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, `CORS_ALLOWED_ORIGINS`.
- `infra/.env.deploy.example` — new file (template; not gitignored).
- `infra/.env.deploy` — gitignored (operator-local only).
- `README.md` — updated to document deploy prerequisites.
- `.gitignore` — add `infra/.env.deploy`.

## Non-goals

- Removing GCP project/resource references (`helio-493120`, `us-west1`, `helio-db`, etc.) — these are structural infrastructure references already visible in other public files and are out of scope for this ticket.
- Migrating the entire deploy workflow to Terraform or CI secrets.
