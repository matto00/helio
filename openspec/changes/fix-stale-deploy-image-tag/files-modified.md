# Files Modified — HEL-753

- `infra/deploy-backend.sh` — removed the hardcoded `--image=...helio-backend:v3` flag; added a
  guard before `gcloud run deploy` that scans `"$@"` (via a here-string, not a pipe, to avoid a
  `pipefail`/SIGPIPE false-negative with `grep -q`) for `--image=` and exits non-zero with
  actionable guidance (both the `gcloud run services describe` currently-live-tag lookup and the
  `cd-backend.yml` CI-built-tag lookup) to stderr if absent, without invoking `gcloud`.
- `infra/README.md` — rewrote the "Run the deploy" section: documents the script as a
  manual/bootstrap deploy path distinct from the automated `cd-backend.yml` CD pipeline, the
  required `--image=<full-image-path:tag>` flag, and both ways to determine the correct tag.
- `openspec/changes/fix-stale-deploy-image-tag/tasks.md` — marked all tasks (1.1–1.5, 2.1, 3.1)
  complete as implemented/verified.
