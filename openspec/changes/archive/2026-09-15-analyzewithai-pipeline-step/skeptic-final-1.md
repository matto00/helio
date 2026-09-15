## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit reviewed: `d4e3a0d7bffbb0276cb2da53f20af8830906953c` (HEAD at review time,
matches the diff base `1977c0f1...HEAD` and the evaluator's `evaluation-1.md`).
No UI/`frontend/**` files touched — design-judgment step (Step 4) skipped.

### What I verified (with evidence)

1. **AC — declared output schema enforced, no partial columns.**
   Read `backend/src/main/scala/com/helio/domain/steps/AnalyzeWithAiStep.scala` in
   full. `enforce()` only ever returns a fully-validated `Map[String, Any]` — every
   failure path (`response-malformed-json`, `response-not-object`,
   `response-missing-field`, `response-extra-field`, `response-wrong-type`) throws
   before any column is appended, and `apply()`'s `rows.foldLeft` only accumulates a
   row after `enforce` succeeds for it, so a later bad row cannot leave earlier rows
   materialized (the whole `Future` fails, and the API surface never exposes a
   partial `acc`). I wrote and ran a throwaway 2-row spec (row 1 conforms, row 2
   fails `response-missing-field`) confirming the whole call fails — 1 test, passed,
   then deleted (not part of the shipped diff; ground-truth probe only).

2. **Failure-arm mutation re-verification (independent of the evaluator's own
   re-run).** I applied 3 of my own mutations to `AnalyzeWithAiStep.scala` (not the
   same 5 rows the evaluator re-ran) and confirmed each turns exactly one named
   test RED, then reverted byte-for-byte via `git checkout`:
   - `missing = declaredKeys.diff(nonNullKeys)` → `.diff(actualKeys)`: turns "declared key present but JSON null" RED (1 failed / 18).
   - `extra = actualKeys.diff(declaredKeys)` → `Set.empty[String]`: turns "response-extra-field" RED (1 failed / 18).
   - `if (n == null || parser.nextToken() != null)` → `if (n == null)`: turns "trailing content" RED (1 failed / 18).
   All three reproduced the claimed failure mode; `git status --short` confirmed a
   clean revert after each. Combined with the evaluator's independently-reported
   re-run of 5 other rows (all exact matches), the failure arms are genuinely
   failable, not vacuous/crash-swallowing.

3. **Column order preservation.** `AnalyzeWithAiConfig.format.write` emits
   `outputSchema` as `JsArray` (never `JsObject`), sidestepping spray-json's
   alphabetical key-sort (`AnalyzeWithAiConfig.scala:46-52`). `enforce`'s final
   `cfg.outputSchema.map{...}.toMap` iterates in declared order.
   `PipelineAnalyzeService.inferAnalyzeWithAi` appends declared columns in
   declared order after removing any input-schema fields the declared names
   shadow. Ran `AnalyzeWithAiConfigSpec` ("preserve outputSchema array order
   exactly as written", "write outputSchema as a JsArray... rather than a
   JsObject", "round trip through write then read unchanged") — all pass.

4. **AI client reaches every production engine path.** Traced the wiring live:
   `ApiRoutes.scala` builds `aiStepClient` once from `ClaudeConfig.fromEnv()`
   (degrading to `AiStepClient.Unavailable` on a missing key, backend still
   boots) and threads it into the single `pipelineRunService`
   (`ApiRoutes.scala:322-351`). `PipelineRunService` builds exactly one
   `InProcessPipelineEngine` (`PipelineRunService.scala:114`) used by both
   `executeRun` and `previewStep` (manual run + preview share one engine
   instance). `Main.scala:240` confirms `PipelineSchedulerService` is
   constructed with `apiRoutes.pipelineRunService` — the same instance, not a
   fresh one — so scheduled runs share the identical `aiStepClient` wiring. Ran
   `PipelineRunServiceAiStepClientWiringSpec` fresh (DB-backed, not
   evaluator-pasted): default client → `ai-unavailable`; explicit
   `ClaudeAiStepClient` over a `FailingTransport` → `ai-error` (not
   `ai-unavailable`), proving the constructor param genuinely reaches the
   executed step, not merely that it compiles. 3/3 passed.

5. **`AiStepClient.complete` is the single model call point.** `grep` confirms
   `ctx.aiClient.complete(...)` is the only call site in
   `AnalyzeWithAiStep.scala`, and `client.send(...)` (the real `ClaudeClient`
   call) appears only inside `ClaudeAiStepClient.complete`. The HEL-1108 call
   point is documented both on the class and inline inside `complete`.
   `generatetext` appears ONLY in `PipelineCostEstimator.AiOps` (pre-existing
   from HEL-1092, confirmed unchanged by this diff) and in doc comments — no
   step implementation, no route, no tier gating anywhere in the diff.

6. **`rowToDomain` decode + analyze 200.** `PipelineStepRepository.scala`'s
   `rowToDomain` match gained a `case Success(cfg: AnalyzeWithAiConfig) =>` arm
   mirroring every sibling step. Ran `PipelineAnalyzeAnalyzeWithAiSpec` fresh
   (embedded Postgres, real Flyway migrate, real repo/service stack) — both
   tests pass, proving `GET /pipelines/:id/analyze` succeeds for a persisted
   `analyzewithai` step without ever constructing an AI client.

7. **Cost partition unchanged.** `PipelineCostEstimator.AiOps` diff-checked:
   zero lines changed in this ticket's diff (`git diff` confirms
   `PipelineCostEstimator.scala` is not even in the changed-file list). Ran
   `PipelineCostEstimatorSpec` fresh — 18/18 pass, including "op coverage"
   (partitions every registered op into exactly one of the four sets) and "deny
   with ai-step ... deny with generatetext as ai-step too".

8. **Zero network calls.** Every AI-touching spec
   (`AnalyzeWithAiStepSpec`, `PipelineRunServiceAiStepClientWiringSpec`) uses a
   hand-written fake `ClaudeTransport`/`FailingTransport` behind the real
   `ClaudeClient`/`ClaudeAiStepClient` — confirmed by reading both files in
   full; no `HttpClaudeTransport` construction anywhere in test code.

9. **Full regression suite, run fresh (not evaluator-pasted).** `cd backend &&
   sbt test`, independently invoked, completed in 278s:
   `Tests: succeeded 4492, failed 0, canceled 0, ignored 0, pending 0` — matches
   the evaluator's own independently-run figure exactly (4492/4492), giving two
   independent fresh runs in agreement.

10. **helio-mcp docs.** `write.ts`'s tool description addition accurately
    describes the enforcement semantics (whole-run failure on non-conforming
    response, never partially applied; `ai-unavailable` when unconfigured;
    analyze never calls the model) — matches the actual code behavior verified
    above, not aspirational.

### Gaps noted (non-blocking)

- No test in the shipped suite explicitly exercises the **multi-row**
  atomicity claim at the `AnalyzeWithAiStep.apply` level (row 1 succeeds, row 2
  fails, assert row 1 is unobservable). The AC's parenthetical
  ("...including across multiple rows...") is satisfied **by construction**
  (verified myself with a throwaway probe, see item 1) — the `Future`-returning
  API gives no code path to observe a partial `acc` even if one existed — so
  this is a coverage gap, not a functional defect. Worth a follow-up unit test
  but not a ship-blocker given the structural guarantee.

### Verdict: CONFIRM

All acceptance criteria trace to real, independently-verified code and
passing tests. Iron Laws (verification-before-completion, mutation-provable
failure arms) were followed by both the executor and evaluator, and I
independently reproduced the load-bearing claims rather than trusting the
evaluator's narrative. No scope creep, no weakened guards, no tier-gating or
`generatetext` implementation snuck in.

### Non-blocking notes

- Consider adding an explicit multi-row atomicity unit test (see Gap above)
  in a follow-up, even though the current design makes the failure mode
  structurally unreachable.
