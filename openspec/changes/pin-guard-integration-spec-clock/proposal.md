## Why

`PipelineRunGuardIntegrationSpec` builds `PipelineRunService` without `guardClock`, so its rate-limit tests
(budgets of 1-2, `rateWindowSeconds = 3600`) bucket admissions by real wall-clock, epoch-aligned hour windows. A test
whose sequential submissions straddle a real hour boundary lands the "should be rejected" submission in a fresh
bucket and fails. HEL-1195 widened the window from 60s to 3600s because, at that time, there was "no clock-injection
seam"; HEL-1374 has since added `guardClock`, and HEL-1439 fixed the same class in `AutoRunGuardBurstProofSpec`.

## What Changes

- `PipelineRunGuardIntegrationSpec`: both service factories pass a pinned test clock as `guardClock`, so every
  rate-window admission lands in one deterministic bucket independent of wall clock. The stale HEL-1195 doc comment
  is corrected.
- Sweep: every other spec constructing `PipelineRunService` with a real `pipelineRunGuardRepo` is classified as
  boundary-sensitive or not; any boundary-sensitive one gets the same fix.
- Red-first probe evidence (forced real boundary crossing), green after, and a by-log loop proof.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None (test-only change; `skip_specs: true`).

## Impact

Test code only under `backend/src/test/`. No production code, schema, API or config change.

## Non-goals

- Changing production rate-window semantics or `PipelineRunGuardRepository`.
- Touching `EmbeddedPostgres.builder()...start()` lines (HEL-1445 owns them).
- Retries, widened windows, or tolerance changes as a substitute for pinning the clock.
