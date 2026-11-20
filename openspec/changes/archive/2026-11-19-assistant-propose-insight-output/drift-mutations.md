## M1 patch-set no-render (backfill triggers a render)

```
M1 (D5): PipelineRunService.backfillOutputNode also calls insightTrigger.afterRunSucceeded -> AssistantInsightNoRenderSpec must go RED
[info] - should write no render and make no model call, even for an on_run insight on a pipeline that already succeeded *** FAILED ***
[info] Tests: succeeded 3, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
[error] Failed tests:
[error] 	com.helio.services.patchsets.AssistantInsightNoRenderSpec
[error] (Test / testSelected) sbt.TestsFailedException: Tests unsuccessful
[error] elapsed time: 5 s, cache 93%, 27 disk cache hits, 2 onsite tasks
```

## M2 D7: drop Insight from the derived kind enum (OutputKindDriftSpec)

```
[info] - should propose_pipeline's Output kind enum equals the canonical kinds *** FAILED ***
[info] - should propose_combined's Output kind enum equals the canonical kinds *** FAILED ***
[info] Tests: succeeded 14, failed 2, canceled 0, ignored 0, pending 0
[info] *** 2 TESTS FAILED ***
```

## M3 D7: KeysDoc filters insight out again (the old DocumentedKnownKeys behaviour)

```
[info] - should KeysDoc documents every insight key and value inside its insight: segment *** FAILED ***
[info] Tests: succeeded 15, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

## M4 D4: resolveOutputCreate skips the stored-id reads check

```
[info] - should RED: reject at preview a reads.outputs id that is not an Output of that pipeline *** FAILED ***
[info] Tests: succeeded 5, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

## M5 D4: set-level pass for reads of Outputs deleted in the same set removed

```
[info] - should RED: reject at preview a reads.outputs id of an Output the same set deletes *** FAILED ***
[info] Tests: succeeded 5, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

## M6 D4: resolveOutputUpdate skips the reads check

```
[info] - should RED: reject at preview a reads.outputs id that is not an Output of that pipeline *** FAILED ***
[info] Tests: succeeded 5, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

## Cycle 2 (CR1): backfill-registration race

Fix: Wiring.awaitBackfills(expected) polls (30 s bound) until the backfill future is registered, then awaits it. Probe applied in place (backup copy restored byte-identical, verified by diff; no scratch worktree): a 300 ms delay on the findById future in OutputService.backfillCreated.

```
## Cycle 2: 300 ms findById delay probe (backfillCreated), AssistantInsightNoRenderSpec must stay green
[info] Tests: succeeded 4, failed 0, canceled 0, ignored 0, pending 0
## Cycle 2: M1 re-run with the fixed wait
[info] - should write no render and make no model call, even for an on_run insight on a pipeline that already succeeded *** FAILED ***
[info] Tests: succeeded 3, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
[error] Failed tests:
[error] 	com.helio.services.patchsets.AssistantInsightNoRenderSpec
[error] (Test / testSelected) sbt.TestsFailedException: Tests unsuccessful
[error] elapsed time: 4 s, cache 93%, 27 disk cache hits, 2 onsite tasks
```
