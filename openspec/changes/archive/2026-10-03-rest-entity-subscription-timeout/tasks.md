## 1. Deploy configuration

- [x] 1.1 Add `--no-cpu-throttling` to the `flags` in `.github/workflows/cd-backend.yml` and verify by grep plus `gcloud run deploy --help` (read-only) showing the flag exists
- [x] 1.2 Add `--no-cpu-throttling` to `infra/deploy-backend.sh` and verify with `bash -n` and grep

## 2. Static guard

- [x] 2.1 Add (or extend an existing) check script asserting both files carry the flag, with a selftest that fails when the flag is removed; verify it passes on the tree and fails under mutation, and wire it per repo convention

## 3. Docs

- [x] 3.1 Add a `docs/deployment.md` section citing HEL-1245 (why, billing trade-off) and update the CD flags list; verify with prettier/format check

## 4. Verify

- [x] 4.1 Run the repo's applicable gates (format check, new check script and selftest, openspec validate); no backend/frontend code changed so full sbt is not required unless the guard touches them

## Standing Constraints

- [C1] No gcloud or prod action by any agent (read-only gcloud help allowed); the driver applies the prod change. Do not ship H2/stream-stage hardening; no timeout bump.
- [C2] Guard must match `--no-cpu-throttling` as a whole token inside the actual `flags:` value and the `gcloud run deploy` invocation (comments must not satisfy it), reject the positive `--cpu-throttling`, wire into `.github/workflows/ci.yml` (+ `package.json` `check:*`), selftest mutating each file independently.
- [C3] Docs: note `--min-instances=0` still means scheduled runs depend on an instance existing; document `gcloud run services describe` showing `cpu-throttling: false` as the prod verification signal; update the flags comment at cd-backend.yml:85 and flag list at docs/deployment.md CD trace.
