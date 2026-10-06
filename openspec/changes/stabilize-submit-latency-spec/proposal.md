## Why

`DatasetWriteSubmitLatencySpec` (HEL-1096) asserted `p50(after) >= p50(before) - 5ms` on wall-clock samples. It
failed once under a contended `testFull` (after 25ms, before 36ms). Not reproduced within the 3-4 worker cap (0/26
whole-spec runs, 0/63 phase-boundary tests, 0/30 in-JVM repeats), so the cause is unproven. Unloaded, after is
3-4x before (34/25/22ms vs 11/6/6ms); warm-up bias is only 10-20ms, so it cannot invert the gap alone. Supported but
unconfirmed: a loaded before phase then a quiet after phase. A silently degraded evaluation was not seen in about
1500 writes but is not excluded. The fix holds under any hypothesis. See probe.md.

## What Changes

- Replace the wall-clock assertion in the default suite with a deterministic one that proves the guard's stated
  intent: the "after" (awaited) writes really perform the downstream evaluation, and the "before" writes do not. The
  proof is the count of denied pipelines folded into each write's response (2 on the after path, 0 on the before
  path, on the existing 5-pipeline fixture), for `appendFormRow`, `replaceRows`, and `patchRow`.
- Move the p50/p95 measurement (sampling, warm-up, report lines) behind an opt-in `HELIO_MEASURE=1`. It reports
  only and never decides pass/fail, as the spec's own scaladoc already states.
- No threshold is loosened. No product code changes.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none). This is a test-only change with no spec-level behavior change, so `.openspec.yaml` sets `skip_specs: true`.

## Impact

- `backend/src/test/scala/com/helio/services/sources/DatasetWriteSubmitLatencySpec.scala` only.
- The default suite runs fewer timed iterations (faster), and no wall-clock comparison remains in it.

## Non-goals

- The repo-wide wall-clock/sleep audit and the 3-fork CI trial (HEL-1341).
- Changing `AutoRunTriggerService`/`DataSourceService` behavior or latency.
- CI config (`ci.yml`), `playwright.config.ts`, `.gitignore`.
