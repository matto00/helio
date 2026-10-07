## Why

sbt 2 in CI has twice gone silent right after "set current project to helio-backend" (security SBOM step, 43.5 min;
e2e leg 4 backend start, 300 s), both times in thin-client mode (sbtn handing off to a background server JVM) and both
times with nothing in the log to explain it. HEL-1296/HEL-1288 bounded the damage but left no way to find the cause:
when the bound fires, nothing about the JVM's state is captured. Separately, the osv-scanner download and scan steps
have no step timeout, so a stalled network call holds the security job until its 5-minute job bound.

## What Changes

- Decide, with CI measurements, whether every CI sbt invocation (backend "Compile and test", security "Generate backend
  SBOM", e2e "Start backend") runs without the thin client (official runner `--server`: one foreground sbt JVM, no
  sbtn handoff). Ship it only if it does not cost real time; otherwise escalate with the numbers.
- Wrap those sbt invocations so that an in-step deadline (inside the step's existing `timeout-minutes`) captures a
  thread dump of the sbt JVM (PID taken from a recorded source, never a process-name match), uploads it as an
  artifact, then stops only the recorded process group and fails the step.
- Extend `scripts/e2e-backend.sh`'s existing fail-fast `die` path to capture the same thread dump before failing.
- Add `timeout-minutes` to "Install osv-scanner" and "Scan backend SBOM (osv-scanner)", sized at 2-3x measured.
- Record before/after CI timing and diagnostics evidence across several runs.

## Capabilities

### New Capabilities
- `ci-sbt-invocation`: how CI runs sbt (client mode decision) and what diagnostics a hung/timed-out sbt step leaves.

### Modified Capabilities
- `ci-security-job-reporting`: adds a time-bound requirement for the two osv-scanner steps.

## Impact

`.github/workflows/ci.yml` (sbt steps in backend/security/e2e, osv steps, artifact uploads), `scripts/e2e-backend.sh`,
one new CI helper script + its selftest under `scripts/`. No application code, no schema, no runtime behaviour.

## Non-goals

- Fixing sbt itself or upgrading sbt / setup-sbt / the sbt runner version (dependabot PR #748 owns version bumps).
- Fork-concurrency or test-grouping changes (HEL-1341); shard counts or compile-cache keys (HEL-1287); e2e sharding
  (HEL-1288).
- Retrying a hung sbt automatically (a hang must stay a loud failure).
