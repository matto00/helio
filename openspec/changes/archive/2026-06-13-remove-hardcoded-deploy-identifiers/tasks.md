## 1. Infra Script

- [x] 1.1 Add `GOOGLE_CLIENT_ID` to `--set-secrets` in `infra/deploy-backend.sh`, referencing `helio-google-client-id:latest`
- [x] 1.2 Remove `GOOGLE_CLIENT_ID=<hardcoded-value>` from `--set-env-vars` in `infra/deploy-backend.sh`
- [x] 1.3 Add `set -a; source "$(dirname "$0")/.env.deploy"; set +a` near top of script (after `set -euo pipefail`) to load `.env.deploy` variables
- [x] 1.4 Remove `GOOGLE_REDIRECT_URI=...` and `CORS_ALLOWED_ORIGINS=...` hardcoded values from `--set-env-vars`; they will be provided via `.env.deploy`
- [x] 1.5 Verify `bash -n infra/deploy-backend.sh` exits 0 (syntax check)
- [x] 1.6 Verify `grep -E 'GOOGLE_CLIENT_ID=[0-9]' infra/deploy-backend.sh` returns no matches

## 2. Template and Gitignore

- [x] 2.1 Create `infra/.env.deploy.example` with placeholder values for `GOOGLE_REDIRECT_URI` and `CORS_ALLOWED_ORIGINS`
- [x] 2.2 Add `infra/.env.deploy` to `.gitignore`

## 3. Documentation

- [x] 3.1 Update `infra/README.md` to document the `deploy-backend.sh` workflow: prerequisites (`.env.deploy` file, Secret Manager secrets), variables list, and run instructions

## 4. Verification

- [x] 4.1 Confirm `git check-ignore -q infra/.env.deploy` exits 0
- [x] 4.2 Confirm `bash -n infra/deploy-backend.sh` exits 0
- [x] 4.3 Confirm no hardcoded OAuth Client ID value in `infra/deploy-backend.sh` (grep)
