## Why

`infra/deploy-backend.sh` hardcodes `--image=...helio-backend:v3`, a static tag that
has not tracked the real deploy pipeline's git-sha-based tags
(`.github/workflows/cd-backend.yml` builds and pushes `${BRANCH}-${SHA}` on every
push to `release/**` and never touches `:v3`). Running the script as-is silently
downgrades the running production application to a materially stale build while
applying whatever else the script does. Confirmed live during HEL-749's cutover
(2026-08-19): the running revision was built from `release-v1.6-4b1d794f`, while
the script's hardcoded tag pointed at an older build; HEL-749 worked around it
with an explicit `--image=` override via the script's `"$@"` passthrough. This
ticket fixes the script's default behavior so a future ad-hoc/manual invocation
can't repeat the same silent downgrade.

## What Changes

- Remove the hardcoded `--image=...:v3` flag from `infra/deploy-backend.sh`.
- **BREAKING** (script CLI contract): the script now requires the caller to pass
  `--image=<full-image-path:tag>` explicitly via its existing `"$@"` passthrough,
  and exits non-zero with guidance before invoking `gcloud run deploy` if no
  `--image=` flag is present — turning a silent downgrade into a fail-fast error.
- Document in `infra/README.md` that `deploy-backend.sh` is a manual/bootstrap
  deploy path (distinct from the automated `cd-backend.yml` CD pipeline), that it
  requires an explicit `--image=` flag, and how to determine the correct tag
  (currently-live tag via `gcloud run services describe`, or a CI-built tag from
  the matching `cd-backend.yml` run).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `production-deployment-docs`: `infra/deploy-backend.sh` no longer hardcodes an
  image tag and now requires an explicit `--image=` override, refusing to run
  without one; `infra/README.md`'s Cloud Run deployment section documents this
  requirement and the script's bootstrap/manual nature.

## Impact

- `infra/deploy-backend.sh` — remove the hardcoded `--image=` flag, add an
  explicit-flag guard.
- `infra/README.md` — document the new `--image=` requirement and the script's
  relationship to `cd-backend.yml`.
- No application code, schema, or API changes. No behavior change to the
  automated `cd-backend.yml` CD pipeline.

## Non-goals

- Making `deploy-backend.sh` build/push an image itself (option (a) from the
  ticket) — the script has no build step today and duplicating `cd-backend.yml`'s
  build+push here is a larger scope change than this ticket's stale-tag bug fix.
- The `--set-env-vars`/`--set-secrets` full-replace footgun flagged separately
  during HEL-749's evaluation — tracked as its own follow-up, out of scope here.
