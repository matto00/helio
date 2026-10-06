## Why

The CI `security` job has two defects. First, "Generate backend SBOM" has no step timeout: on run 37361823617
attempt 1 it sat silent for 43 minutes until it was cancelled by hand. Second, a failing audit step silently skips
every later audit step. On runs 37396677223 and 37400422292, a frontend/ audit failure hid a critical proxy-addr
advisory in helio-mcp, because the helio-mcp audit never ran.

## What Changes

- Add a step-level `timeout-minutes` to "Generate backend SBOM". The job keeps its existing 5-minute timeout from
  HEL-1287, and the step bound is sized so the remaining steps still fit inside it.
- Make each independent audit step (Frontend root, Frontend frontend/, helio-mcp) run whenever its own
  prerequisites succeeded, even if an earlier audit step failed. The job's conclusion is still `failure` if any
  step failed.
- Record the hung run's log findings and the cause analysis in design.md. The hung run's log is retrievable.
- Prove the unmasking on a real CI run: a throwaway commit makes the frontend/ audit fail, and the helio-mcp audit
  still runs and reports. The throwaway is reverted before the final head.

## Capabilities

### New Capabilities
- `ci-security-job-reporting`: the `security` job reports every audit independently, and bounds its SBOM step.

### Modified Capabilities
<!-- none: backend-ci-test-execution's job-timeout requirement is unchanged (job timeout stays 5 min) -->

## Non-goals

- Any edit outside the `security` job in `.github/workflows/ci.yml`. The e2e job belongs to HEL-1288 / PR #774.
- Changing audit thresholds or allowlists (the moderate frontend advisories are HEL-1320).
- Step timeouts on the osv-scanner download/scan steps, and sbt thin-client changes. Both are noted as follow-ups.
- Proving the root cause of the 2026-10-05 hang beyond what the retained logs show.

## Impact

- `.github/workflows/ci.yml`, `security` job only.
- `ci-complete` is unchanged; it already fails when `security` fails.
