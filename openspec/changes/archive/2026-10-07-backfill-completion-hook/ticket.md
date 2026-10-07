# HEL-1356: Make OutputRoutesSpec negative check wait on a real completion hook

## Description

Found during HEL-1341. The test at `OutputRoutesSpec.scala:~780` checks that something did NOT happen. Without a production-side completion signal, it cannot tell "it didn't happen" from "it hasn't happened yet". So no wait it uses can make the negative check sound.

## Fix

Add a completion hook in production code, observable from the test, that fires when the relevant async work has finished. Have the spec await that hook before asserting the negative.

## Acceptance

* The negative assertion runs only after the completion hook has fired.
* Mutation check: if the code is broken so the forbidden effect happens late, the test still goes red.

## Premise validation (orchestrator, verified against main @ 67c8ab224)

* The test is `"does not backfill and stays materialized=false for an Output created on a node that has never run"`, lines 775-796 of `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala`. It does `Thread.sleep(200)` and then asserts `materialized=false` / empty items.
* The production-hook diagnosis holds: `OutputService.triggerBackfill` (OutputService.scala:61-66) discards the `Future[Unit]` returned by `PipelineRunService.backfillOutputNode`, and `PipelineRunService` is `final`, so a spec cannot wrap it to observe completion.
