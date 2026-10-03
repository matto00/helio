## Why

Prod REST-source scheduled runs intermittently fail with `Response entity was not subscribed after 1 second` (HEL-1245). Local probes through the real driver refuted every code-level hypothesis (dispatcher starvation, pool slots, non-draining branches, intervening code). Read-only prod evidence (ticket comment) established the cause: Cloud Run CPU throttling is ON (`cpu: 1`, no `cpu-throttling=false`); all 14 failures were 13:00-13:31 UTC scheduled runs outside request handling; on 2026-10-02 Pekko logged the timeout at 13:19:47.77 while the driver's failure handler ran at 13:19:52.08, the same millisecond a `/health` request gave the container CPU. The 1s timer fired on thaw before the continuation ran.

Owner ruling (2026-10-03): turn CPU throttling off.

## What Changes

- Add `--no-cpu-throttling` to `.github/workflows/cd-backend.yml` deploy flags and to `infra/deploy-backend.sh`; flag existence verified via `gcloud run deploy --help` (read-only).
- Document the why and the billing trade-off in `docs/deployment.md`.
- Add a static guard that fails if CD's deploy flags lose `--no-cpu-throttling`.
- Explicitly NOT in scope: the pool-per-request hardening (filed as a follow-up) and any timeout bump. The "red test before the fix" AC cannot apply to an infra setting; the root cause is established by the prod log timing signature (evidence: HEL-1245 ticket comment), a substitution the skeptic gates judge explicitly.
- The prod change itself is made by the driver, not by this PR or this run.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-deployment-docs`: backend deploy paths and docs require always-allocated CPU.

## Impact

CI/CD workflow, deploy script, docs, one static check script. No application code.
