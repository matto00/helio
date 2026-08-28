# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `05a38156` on `feature/name-failing-pipeline-step/HEL-859`.
Every claim below was established by my own fresh run, not from the executor's handoff.

## Phase 1: Spec Review — PASS

Issues: none blocking.

### Acceptance criteria — all six re-checked against the tree and against a live server

| AC | Verdict | Evidence |
| --- | --- | --- |
| AC1 run error names step id + type + reason | PASS | Live `POST /api/pipelines/:id/run` → `422 {"message":"Pipeline execution failed at step dc3d32a6-9fa4-4833-a6af-3943c2f785d5 (stringops): Unsupported stringops operation: 'regexExtract'. Supported: trim, upper, lower, split, extractRegex, concat"}`. Test `PipelineRunRoutesSpec` "…names the step id, kind, and reason" asserts all four tokens in one test. |
| AC2 analyze reports non-`none` validationError | PASS | Live `GET /api/pipelines/:id/analyze` → step `validationError` populated (was `null` on `main`), `outputSchema == inputSchema`. |
| AC3 `regexExtract` surfaces `extractRegex` at analyze time | PASS | Live analyze message names both the rejected `regexExtract` and the supported `extractRegex`. |
| AC4 no stack traces / internal class names | PASS | Allowlist in `InProcessPipelineEngine.StepExecutionException.from`; verified by mutation probe (below), not by reading. |
| AC5 successful runs unaffected; contract reflected | PASS | Full backend suite 3672/3672 (below). `npm run check:schemas` — "schemas in sync with JsonProtocols (67 checked)". `npm run check:openspec` — "openspec/ is clean". Two spec deltas added. |
| AC6 curated error reaches the MCP surface | PASS | Verified end-to-end by me through the real `HelioHttpClient`/`HelioApi`/`guarded` code path (below). |

**AC6 — I did not take the executor's word, and no MCP artifact was committed.** I minted a PAT, drove the
real MCP client code (`src/helioApi.ts` + `src/httpClient.ts` + `write.ts`'s `guarded` formatter) against
the live backend, and captured the literal text a caller receives:

```
=== MCP analyze_pipeline tool text ===
{ "validationError": "Unsupported stringops operation: 'regexExtract'. Supported: trim, upper, lower, split, extractRegex, concat" }

=== MCP run_pipeline tool text ===
HelioApiError (status 422) for http://localhost:9198/api/pipelines/.../run: 422 Unprocessable Content:
Pipeline execution failed at step dc3d32a6-9fa4-4833-a6af-3943c2f785d5 (stringops):
Unsupported stringops operation: 'regexExtract'. Supported: trim, upper, lower, split, extractRegex, concat
```

Compare the ticket's reported symptom — `HelioApiError (status 422): 422 unknown: Pipeline execution failed`.
AC6 is genuinely met at the surface the ticket names. Probe artifacts (pipeline, PAT) were deleted from the
shared dev DB afterwards; the worktree is clean.

### Prose-against-code audit (each claim the orchestrator flagged, checked against the diff)

- **Decision 3 — "the static prefix `Pipeline execution failed` is preserved verbatim at the start": TRUE.**
  `StepExecutionException` extends `Exception(s"Pipeline execution failed at step $stepId ($stepKind): $reason")`.
- **Decision 3a — "the Spark path is untouched": TRUE.** `git diff --name-only main...HEAD | grep -i spark`
  returns nothing. `SparkJobSubmitter.scala` and `SparkJobSubmitterSpec.scala` are both absent from the
  14-file code diff, and `SparkJobSubmitterSpec`'s two exact-match assertions on the old string survive
  unmodified and pass in the full suite.
- **Decision 5 / task 3.4a — "BOTH the runtime match AND the error text driven by the extracted val, no
  third copy": TRUE for all four steps.** In `AggregateStep`, `GroupByStep`, `UnionStep` and `JoinStep` the
  `case other => throw new IllegalArgumentException("… Supported: <hardcoded>")` arm was **deleted** (not
  left behind) and replaced by a guard `if (!SupportedX.contains(v)) throw …mkString(", ")` above the match.
  Two copies became one; no third copy exists.
- **No prose denies a behaviour change the code makes.** design.md Decision 3 states outright "This is a
  behaviour change to the message body, not only an addition… Do not describe this change as
  backward-compatible" and enumerates the exact assertions that change. That enumeration matches the diff
  precisely. This is the failure mode that cost the previous leaf a cycle; it is not present here.
- Spec deltas match the code, including the round-2 skeptic's note (the run-execution delta is correctly
  scoped to "a run executed by the in-process pipeline engine", so Decision 3a's Spark exemption does not
  contradict it).
- Task list accurately reflects what shipped. Task 4.1 is marked done with no `schemas/` edit; that is
  correct rather than sloppy — the message is free-text `ErrorResponse.message`, `validationError` is already
  `string|null` in `pipeline-analyze-response.schema.json`, no wire shape changed, and `check:schemas`
  confirms no drift. The openspec half of 4.1 is delivered by the two spec deltas.

### Scope

No scope creep. The one flagged item (item 5 below) is a necessary consequence, not creep. No frontend,
schema, or infra file is touched.

## Phase 2: Code Review — PASS

Issues: none blocking.

### Gates — re-run by me in `WORKTREE_PATH`, not trusted from the handoff

- `cd backend && sbt test` → **`Total number of tests run: 3672` / `Tests: succeeded 3672, failed 0`** /
  `[success] Total time: 200 s`. Independently reproduces the executor's 3672/0 claim.
- `npm run check:scala-quality` → `Scala code-quality check: clean (140 soft warning(s))` — no inline
  fully-qualified names, the one mechanical CONTRIBUTING rule. All 140 size warnings are pre-existing files.
- `npm run check:schemas` → in sync. `npm run check:openspec` → clean.
- Frontend gates: **not applicable** — zero files under `frontend/**` in the diff.

### Red-on-revert, independently re-established against the FINAL committed test files

This is the check the sibling leaf HEL-858 failed. I did not accept the executor's `git stash` transcript.
I created a throwaway detached worktree at `05a38156`, reverted **only** production files to `main` while
leaving every test file at the final committed state, and ran the three affected suites:

```
Total number of tests run: 306
Tests: succeeded 298, failed 8, canceled 0
  - window — an unrecognized function is now reported as a validationError at analyze time *** FAILED ***
  - stringops — analyze-time validation: unsupported operation is reported before any run *** FAILED ***
  - fillnull — analyze-time validation: unsupported strategy is reported before any run *** FAILED ***
  - fillnull — analyze-time validation: constant strategy without value is reported *** FAILED ***
  - POST /pipelines/:id/run … inserts a pipeline_runs row with a step-attributed errorLog *** FAILED ***
  - POST /pipelines/:id/run failure via unsupported stringops operation names the step id, kind, and reason *** FAILED ***
  - POST /pipelines/:id/run failure sets last_run_status to failed and returns 422 naming the failing step *** FAILED ***
  - POST /pipelines/:id/run publishes queued -> running -> failed via SSE naming the failing step *** FAILED ***
```

These are **assertion-level** failures, not compile failures — the tests genuinely discriminate the new
behaviour. The revert transcript therefore still holds against the final test files.

**Mutation probe on the security-critical test (task 5.2).** A green test over the wrong input proves
nothing, so I mutated the allowlist itself — `case other => new StepExecutionException(stepId, stepKind,
"step execution failed", other)` → `…, other.getMessage, other)` — and re-ran:

```
- executeWithStepCounts: a non-IllegalArgumentException failure names the step
  but not the throwable's own message *** FAILED ***
Tests: succeeded 174, failed 1
```

The leak test kills the mutant. It uses a genuine non-`IllegalArgumentException` (a `RuntimeException` from
a purpose-built fake `PipelineStep`), asserts the leaky payload string is absent from both `reason` and
`getMessage`, and asserts the **simple** class name `RuntimeException` is absent — strictly stronger than
the required package-qualified check. Task 5.2 is satisfied properly.

The throwaway worktree was removed; `git worktree list` shows only the main checkout and the delivery
worktree.

### Item 5 — the 19 `intercept[IllegalArgumentException]` → `intercept[StepExecutionException]` conversions

Judged individually. **All 19 are correct and none weakens a test.**

- The count is accurate: 19 converted, 9 left as `IllegalArgumentException`. I confirmed all 9 survivors are
  `engine.loadRows(...)`/`restEngine.loadRows(...)`/`brokenEngine.loadRows(...)` call sites
  (`InProcessPipelineEngineSpec` :2000, :2041, :2093, :2143, :2164, :2200, :2246, :2263, :2293) — `loadRows`
  is outside the step fold and is genuinely untouched by this ticket, so leaving them is right, not lazy.
- The type change is real and unavoidable: `StepExecutionException` extends `Exception`, not
  `IllegalArgumentException`, so every step-execution call site *had* to change or fail to compile. This is
  a consequence of Decisions 1/2, not scope creep. Agreeing with the executor's own characterisation.
- **No weakening.** Every one of the 19 retains its original `ex.getMessage should include (…)` content
  assertion (`"fortnight"`, `"median"`, `"byColumn"`, `"bogus"`, `"separator"`, `"capturing group"`, etc.).
  Because a non-`IllegalArgumentException` would collapse `reason` to the fixed string `step execution
  failed`, those content assertions still *require* the failure to have travelled the allowlisted IAE path.
  The conversions therefore preserve exactly as much discriminating power as before. Confirmed empirically:
  the mutation probe above broke a test in this same file rather than passing silently.

### Code quality

- **DRY / single source of truth**: the core of the change. Eight steps now expose one `SupportedX` val that
  drives the runtime guard, the runtime message, and the analyze-time validator.
- **Modularity**: `validateStepConfig` is a separate hook from `infer*` (Decision 4), keeping inference
  tolerant and validation strict. Per-kind validators are small and uniform.
- **Type safety**: no `Any`-escape hatches introduced; `StepExecutionException.from` pattern-matches on
  concrete types.
- **Security**: the allowlist fails closed and is mutation-tested. `cause` is retained for server-side
  logging only; `log.error(…, ex)` calls in `PipelineRunService` are unchanged, so the full throwable is
  still logged while only the curated text is returned.
- **Error handling**: the synchronous-throw bug the executor found (eagerly-evaluated `Future.successful(
  Step.apply(...))` bypassing `.recoverWith`) is a real defect, correctly root-caused with a probe, and
  correctly fixed by wrapping the `evaluate` call in `try/catch` before the combinator chain is attached.
  Without it, the majority of step kinds would have escaped attribution entirely.
- **No dead code, no TODO/FIXME, no over-engineering.** Comments cite the design decision each block
  implements.
- **Behaviour preservation where expected**: the four already-compliant steps got a `private` removal only.

## Phase 3: UI Review — N/A

No UI-affecting file changed. `git diff --name-only main...HEAD` contains only `backend/src/**` and
`openspec/changes/**`; there are zero entries under `frontend/**`, `schemas/**`, `openspec/specs/**`, or
`ApiRoutes.scala`. Frontend behaviour is untouched, as the orchestrator's framing anticipated. (Dev servers
were nonetheless started and used for the AC1–AC4 and AC6 live verification recorded in Phase 1.)

## Overall: PASS

## Change Requests

None.

## Non-blocking Suggestions

1. **Non-exhaustive `match` left behind in the four rewritten steps.** Removing the `case other =>` arm from
   `AggregateStep`, `GroupByStep`, `UnionStep` and `JoinStep` satisfies Decision 5's letter (the guard and
   the message are both driven by `SupportedX`), but the match *arms* are still a second hand-maintained
   list. Adding a value to `SupportedX` without adding an arm now yields a `scala.MatchError`, which is not
   an `IllegalArgumentException` and so degrades to the opaque `step execution failed` — the exact class of
   silent unhelpfulness this ticket exists to remove. Not a defect today (the lists agree; suite is green).
   Consider a `case other => throw new IllegalStateException(s"$other is in SupportedX but has no arm")`
   backstop, or driving the arms from a `Map[String, …]`.
2. **Route-level HEL-311 leak guards were dropped, not replaced.** `PipelineRunRoutesSpec` previously
   asserted `should not include missingSourceId` / `should not include "DataSource not found for join"`;
   those lines are gone (correctly — the allowlist now forwards that IAE text on purpose), and the new exact
   `shouldBe` is strictly stronger for *that* case. But the no-leak property for *non*-IAE throwables is now
   guarded only at the engine unit level. A route-level test with a non-IAE failure would keep the guarantee
   pinned at the HTTP boundary where HEL-311 originally placed it.
3. **Analyze-time messages are worded independently of the runtime messages.** e.g. `PipelineAnalyzeService.
   validateStringOps` composes its own `"Unsupported stringops operation: '…'. Supported: …"` rather than
   reusing `StringOpsStep`'s. The *set* is shared (which is what Decision 5 requires and what prevents false
   positives), but the two message strings are coincidentally identical today and can drift in wording.
4. **`validateStepConfig`'s blanket `catch { case _: Exception => Vector.empty }`** is deliberate and
   documented (malformed configs must fall through to the existing `parseConfig` handling), but it would also
   silently swallow a genuine bug inside a validator. Narrowing it to the decode call, or to
   `DeserializationException`, would keep the intent without the blast radius.
5. **`GroupByStep`'s guard now fires on an empty row set** where the old `case other =>` arm could not be
   reached (it lived inside the per-group fold). This is a strict improvement — failing loudly is the point
   of the ticket — but it is an un-narrated behaviour change; `AggregateStep`'s guard, placed inside the
   aggregation loop, retains the old empty-input silence, so the two are now asymmetric. Worth a sentence in
   design.md or a follow-up to align them.
6. **No evidence artifact was committed for tasks 5.7 and 6.1.** The sibling leaf HEL-858 persisted
   `evidence/red-verification.md`; this change dir has none, so the red-on-revert and MCP claims arrived as
   prose only. Both claims turned out to be **true** — I reproduced them independently, which is why this is
   not a Change Request — but committing the transcripts would let the next reader verify them without
   rebuilding the whole probe.
