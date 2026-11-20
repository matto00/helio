## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 3b3614e3dcf57772b1ee66ae98c057df64364aa1. Diff base: dfb65eebb (resolved live). Commits: 089d22228 (red tests), 3b3614e3d (implementation).

### Phase 1: Spec Review — PASS
Issues: none.
- AC1 (red-first, validates and applies): `AssistantProposalToolSchemasSpec` enum test and `PatchSetInsightOutputSpec` "preview and apply a valid insight" were committed red in 089d22228 before the implementation commit.
- AC2: the `propose_pipeline`/`propose_combined` kind enum is `OutputKind.all` (`AssistantProposalToolSchemas.scala:306`). `KeysDoc` iterates `KnownKeys`, and `DocumentedKnownKeys` is deleted. `OutputKindDriftSpec`'s exclusion block is replaced by positive checks, and mutations M2 and M3 are recorded red.
- AC3 (no render on create): `AssistantInsightNoRenderSpec` uses a real `InsightRenderService` over a failing fake model, plus an on_run control. The assertion logic is right, but the spec is nondeterministic (Phase 2, CR1).
- AC4: no live model call, only the fake transport.
- Tasks are all marked done and match the diff. Scope matches the design (D1-D8). There is no frontend diff: `git diff --stat` touches no `frontend/**` file, which matches C14 and D8.
- The constraints are honoured: no `.env` access, and the gates ran with `-J-Xmx3g`, `nice -n 19` and shards under 600 s.

### Phase 2: Code Review — FAIL

Gates (my own fresh runs, in WORKTREE_PATH):
- Targeted changed specs (6 files): 97 passed, 0 failed.
- `sbt testOnly com.helio.api.*` (includes `api.routes.*`): 2912 passed, 0 failed (554 s).
- `sbt testOnly com.helio.infrastructure.* domain.* spark.* eval.* testkit.* testsupport.*`: 4706 passed, 0 failed.
- `sbt testOnly com.helio.services.*`: 2451 passed, 0 failed, 5 canceled. The 5 cancellations are the existing opt-in measurement specs (HELIO_MEASURE, heap/latency); none is new.
- Total: 10,069 backend tests green. Logs are in `.concertino/scratch/HEL-1779/eval1-{targeted,api,infra-domain,services}.txt`.
- `npm run lint`, `npm run format:check`, `npm run check:scala-quality`, `check-openspec-hygiene` and root jest (617 tests) are all clean. `frontend/**` is unchanged, so the frontend gates do not apply.

`scripts/check-schema-drift.mjs` is sound. I ran two mutations in a throwaway detached worktree, since removed:
- (A) Removing `case "insight"` from `OutputKind.fromString` makes the script exit 1 with `in JSON Schema, missing from AssistantProposalToolSchemas.scala: insight`.
- (B) Adding `"bogus"` to `create-pipeline-transactional-output-request.schema.json`'s kind enum makes it exit 1 with `missing ... : bogus`.
- Deleting the `KNOWN_PRE_EXISTING_DRIFT` insight entry was correct: an allowance that matches no live drift is itself an error in the script.

The executor's claim about the create preview is verified. On main, `resolveOutputCreate` passed the full config to `OutputFieldMappingCheck`, then `PipelineCreatePreflight.validateOutputConfig`, then `InsightReadsCheck` over `Map.empty`, so any `reads.outputs` was refused (`PipelineCreatePreflight.scala:229`). The fix strips `reads` only for insight, and only before that check. It then judges reads with the stored-id check against `listByPipelineInternal`. The check calls `InsightConfig.parse` on the full config, so a malformed `reads` is still refused at preview. This matches `OutputService.create` at apply. The update path's claim that "`validateConfig` is already run by the projection" is confirmed by `PatchSetPreviewPipelineProjection.scala:28` and the out-of-range GUARD test.

Issues:
1. **A new spec is nondeterministic (blocking).** `AssistantInsightNoRenderSpec.scala:82` asserts `w.awaitBackfills() shouldBe 1` straight after `apply` returns. The backfill future is registered with the observer only after an asynchronous DB round trip that nothing sequences before apply's response:
   - `PatchSetApplyService.scala:165` calls `outputService.backfillCreated(...)` and does not wait for it.
   - `OutputService.backfillCreated` runs `outputRepo.findById(id, user).foreach { triggerBackfill }` (`OutputService.scala:204`). The observer is called only inside that `foreach`.
   - Apply's response is gated only on `journalSuccess`, a separate DB write. Under load, `findById` can complete after the response, so the queue is empty and the assertion sees `0`.

   Probe (self-authenticating; the only change was a scheduling delay with no behaviour change): in a throwaway worktree at 3b3614e3d I added a 300 ms delay to the `findById` future in `backfillCreated`. The result was `0 was not equal to 1 (AssistantInsightNoRenderSpec.scala:82)`, with 1 of 4 tests failing. Log: `.concertino/scratch/HEL-1779/eval1-probeC-backfill-race.txt`.

   This is a likelier cause of the reported under-load failure than the executor's guess (the 20 s `settle` deadline), although the original failure's message was never captured. If the registration arrives late and only the size assertion were relaxed, the next assertions (`calls == 1`, `sends == 0`, rows empty) would run before the backfill and pass vacuously.

### Phase 3: UI Review — N/A
No UI trigger matched: no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change in the diff.

### Overall: FAIL

### Change Requests
1. In `backend/src/test/scala/com/helio/services/patchsets/AssistantInsightNoRenderSpec.scala`, make `Wiring.awaitBackfills` wait for the registration before it awaits the futures. For example: poll until `backfills.size >= expected`, with a bounded deadline (an `until`-style loop or ScalaTest `eventually` with an explicit `PatienceConfig`), then `Await` `Future.sequence` and return the size. The fix must run before the `calls`/`sends`/`rowsOf` assertions, so those assertions are made after the backfill has really completed.
   - Proof: re-run the delay probe above, a 300 ms delay on the `findById` future in `OutputService.backfillCreated`, in a scratch worktree. The spec must stay green with the delay.
   - Mutation M1 (the backfill calls `insightTrigger.afterRunSucceeded`) must still go red.
   - Record both runs in `drift-mutations.md` or the evidence directory.

### Non-blocking Suggestions
- The `propose_pipeline` config description now concatenates `KeysDoc` ("...creating one does not render it") with `InsightNewPipelineReadsDoc` ("Applying this proposal runs the pipeline, and that run renders an insight whose refresh is on_run"). Both are true (creation versus the apply run), but the juxtaposition can read as a contradiction to the model. Consider changing the KeysDoc clause to "creating the Output itself writes no render".
- `PatchSetOutputResolvers.rejectReadsOfDeletedOutputs` restates `InsightReadsCheck`'s message prefix by hand. A shared constant would keep the two messages in step.
- `rejectReadsOfDeletedOutputs` compares `request.kind == "insight"`, a string, where the rest of the file uses `OutputKind.fromString`. This is equivalent today; it would be more uniform to use `OutputKind`.
