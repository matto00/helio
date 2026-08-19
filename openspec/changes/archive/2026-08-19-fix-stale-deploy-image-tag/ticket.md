# HEL-753: infra/deploy-backend.sh hardcodes a stale image tag (:v3), diverges from cd-backend.yml's git-sha-based tagging

## Description

Discovered during HEL-749's Cloud SQL Private IP migration cutover (2026-08-19): `infra/deploy-backend.sh` hardcodes `--image=us-west1-docker.pkg.dev/helio-493120/helio-backend/helio-backend:v3`, a static tag that has not been updated to track recent commits. The actual automated deploy pipeline (`.github/workflows/cd-backend.yml`, triggered on push to `release/**`) builds and pushes a fresh git-sha-tagged image on every deploy (`${BRANCH}-${SHA}`, e.g. `release-v1.6-6b269a79`) and never touches `:v3`.

**Concretely confirmed live**: at the time of discovery, the actually-running production revision was built from `release-v1.6-4b1d794f` (current at the time), while `deploy-backend.sh`'s hardcoded `:v3` tag pointed at a materially older, stale build. Running `deploy-backend.sh` as-is — e.g. for any manual/ad-hoc deploy, not just HEL-749's cutover — would silently *downgrade* the running application code while whatever else the script does gets applied. This wasn't the intended purpose for HEL-749's cutover (an explicit `--image=` override via the ticket's new `"$@"` passthrough was used as a workaround for that one deploy), but the script's default behavior remains a live footgun for any future use.

Pre-existing, not introduced by HEL-749 or any of tonight's other tickets.

## Suggested fix

Either (a) have `deploy-backend.sh` compute the current image tag the same way `cd-backend.yml` does (build+push from the current commit, using the same `${BRANCH}-${SHA}` convention) rather than hardcoding any static tag, or (b) if `deploy-backend.sh` is meant only as a one-time/bootstrap script rather than a routine deploy path, document that explicitly in `infra/README.md` and add a guard that refuses to run without an explicit `--image=` override.

## Links

- Ticket: https://linear.app/helioapp/issue/HEL-753/infradeploy-backendsh-hardcodes-a-stale-image-tag-v3-diverges-from-cd
- Related: HEL-749 (Migrate Cloud Run/Cloud SQL from the connector library to Private IP + Serverless VPC Access)
