## Context

`e2e/hel1277-output-history-scrubber.spec.ts` test 1 (line 57) creates a static source, a pipeline and a table Output,
then: run 1, `PUT rows`, run 2, `PATCH historyPayloads=false`, `PUT rows`, run 3. It asserts the history API has
exactly 3 points, opens the History dialog, and expects the slider at index 2. Test 2 (the chart "vs" overlay) also
calls `putRows` between runs.

`DataSourceService.replaceRows` (`backend/src/main/scala/com/helio/services/sources/DataSourceService.scala:887`, awaited trigger at :899)
awaits `AutoRunTriggerService.triggerAutoRun`, which `upsertDebounce(pipelineId, now + DATASET_WRITE_DEBOUNCE_SECONDS)`
(default 5 s) into `pipeline_auto_run_debounce`. `PipelineSchedulerService`'s tick (default 30 s) claims due rows and
submits an `auto-run` through `PipelineRunService.submit`, which writes a history point like any run. Manual runs do
not clear the pending row. So after the spec's last write a fourth run lands 5-35 s later; whether it beats the
dialog's history fetch depends on where the tick phase falls: a timing-only flake.

`e2e/support/historySeed.ts` already has exact-id DB helpers over `e2e/support/db.cjs` (`setUserTierForTest`,
`backdateHistory`, `historyRowCount`), each asserting its affected-row count.

## Goals / Non-Goals

**Goals:** root cause from a probe; a forced red repro; a deterministic spec that passes 40/40 at 2 workers.

**Non-Goals:** changing auto-run semantics; touching unrelated specs; any retry, sleep or longer timeout.

## Decisions

**D0. Probe before fixing (binding).** Before any spec change the executor:
1. Tries to fetch the failing CI run's Playwright artifact/trace for PR #1129 (`gh run list`/`gh run view`,
   `gh run download` into the scratchpad). If the trace holds the history response, record each point's
   `triggerSource`/`capturedAt`. If the artifact has expired, say so.
2. Reads the thinning/retention code (`OutputHistoryRetentionService` and its thin SQL) and states whether it can ever
   ADD a point (expected: no; it only deletes, and keeps the newest 101 points), ruling the 00:00 UTC theory in or out.
3. Forced repro of the MECHANISM: a temporary edit (never committed) that, after run 3 and the 3-point API check,
   polls the history API every 1 s for at most 50 s (debounce 5 s + one full 30 s tick + run time + margin) until a 4th
   point appears and logs its `triggerSource` (expected `auto-run`), then proceeds to the UI assertion, which must fail
   with `Expected "2" Received "3"`. The temporary variant may raise `test.setTimeout` for itself only; the committed
   spec keeps `120_000`. Record the output as red evidence, labelled "forced repro of the mechanism", never "reproduced
   the CI failure" unless D0.1 recovers a trace showing a 4th point with `triggerSource: auto-run`.
If the probe contradicts the auto-run hypothesis, stop and report back instead of applying D1.

**D1. Cancel the spec's own pending auto-run by exact pipeline id.** Add an e2e support helper
`cancelPendingAutoRun(pipelineId, userId)` in `historySeed.ts` that runs, in the same shape as `backdateHistory`:
`BEGIN; SET LOCAL app.current_user_id = '<userId>'; DELETE FROM pipeline_auto_run_debounce WHERE pipeline_id = '<id>'
AND claimed_at IS NULL RETURNING pipeline_id; COMMIT;` (the table has ENABLE + FORCE RLS with an owner policy via
`pipelines.owner_id`; the SET LOCAL keeps it correct on a non-superuser connection, not only on CI's superuser). It
validates the user id as a UUID and the pipeline id with SAFE_ID, and throws unless exactly one returned id equals the
pipeline id. Call it
immediately after every `putRows` in both tests of this file. The row's `fire_at` is write + 5 s, so the delete always
runs well before the tick can claim it; asserting exactly one deleted row turns "the auto-run was armed and is now gone"
into a checked fact rather than an assumption, and fails loudly if a future change stops arming it (the helper then
needs revisiting, not silently passing).
Alternatives rejected: waiting for the auto-run to land (adds ~35 s per test and changes which point is newest);
reshaping the data change into pipeline-step edits (no write, but cannot express run 2's changed+added rows cleanly);
a product change making manual runs supersede the pending auto-run (contradicts the living
`dataset-write-auto-run` spec, :10-16; recorded as a possible follow-up, not decided here).

**D2. No product change on this path.** The extra point is spec-required auto-run behavior
(`openspec/specs/dataset-write-auto-run/spec.md:10-16`; the rearm design's line 124 covers only the in-flight unclaim
case), so AC 3 is satisfied as
"not a product defect" with the evidence from D0. If D0 finds a genuine duplicate point (two points for one run id),
that becomes a backend fix with a red-first unit test and this design is revised and re-gated.

**D3. Verification.** Red: D0.3 output. Green: `npx playwright test e2e/hel1277-output-history-scrubber.spec.ts
--repeat-each=20 --workers=2` (2 themes x 20 = 40 per test) with no retries, plus the D0.3 forced-wait variant now
passing (the cancelled auto-run never lands across the full 50 s poll, which must cover at least one tick after
`fire_at`), proving the fix addresses
the mechanism rather than shrinking the window.

## Risks / Trade-offs

- The helper relies on table/column names (`pipeline_auto_run_debounce.pipeline_id`, `claimed_at`); a rename breaks
  it loudly, which is the desired failure.
- Deleting by DB bypasses the API, the same accepted pattern as `setUserTierForTest`, scoped to an exact id.

## Planner Notes

- Self-approved: test-only scope, DB-helper approach, `skip_specs: true` (no requirement changes).
- The 00:00 UTC theory is kept as a candidate to rule out in D0.2, not discarded unexamined.
