## 1. Infra script (### Backend)

- [x] 1.1 Remove the hardcoded `--image=us-west1-docker.pkg.dev/helio-493120/helio-backend/helio-backend:v3` flag from `infra/deploy-backend.sh`.
- [x] 1.2 Add a guard before the `gcloud run deploy` invocation: scan `"$@"` for a `--image=` argument; if absent, print guidance (currently-live-tag lookup via `gcloud run services describe`, and CI-built-tag lookup via the matching `cd-backend.yml` run) to stderr and exit non-zero without invoking `gcloud`.
- [x] 1.3 Verify `bash -n infra/deploy-backend.sh` exits 0 (syntactically valid).
- [x] 1.4 Verify `grep -E -- '--image=us-west1-docker' infra/deploy-backend.sh` produces no output (no hardcoded image reference remains).
- [x] 1.5 Manually exercise the guard: run the script with `.env.deploy` missing/stubbed as needed to reach the guard, with no `--image=` flag → confirm non-zero exit and no `gcloud` invocation; then with a dummy `--image=` flag present → confirm the guard passes (stub or dry-run `gcloud` to avoid a real deploy).

## 2. Documentation (### Docs)

- [x] 2.1 Update `infra/README.md`'s "Run the deploy" section: document the required `--image=<full-image-path:tag>` flag, that the script is a manual/bootstrap path distinct from the automated `cd-backend.yml` CD pipeline, and both ways to determine the correct tag (currently-live via `gcloud run services describe`, or CI-built via the matching `cd-backend.yml` run).

## 3. Verification (### Tests)

- [x] 3.1 Re-run all of section 1's verification commands after documentation changes to confirm nothing regressed.
