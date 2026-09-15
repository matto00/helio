## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: d4e3a0d7 (HEL-1106 Add analyzewithai pipeline step)

### Phase 1: Spec Review — PASS
- Ticket AC ("declared output schema enforced on model response; non-conforming response fails
  the step with a named reason rather than silently producing partial columns") is implemented
  exactly: `AnalyzeWithAiStep.enforce` builds the output map only after all keys validate; there
  is no code path returning a partial map (confirmed by reading `AnalyzeWithAiStep.scala`).
- All tasks.md items 1.1-3.7 map to real diff hunks; no task marked done without matching code.
- Standing Constraints:
  - C1: `generatetext`/tier-gating not implemented; `AiStepClient.complete` is the single call
    point, and `ClaudeAiStepClient.complete` carries an explicit "HEL-1108 call point" comment
    (both a doc-comment on the class and an inline comment inside `complete`). PASS.
  - C2: `PipelineCostEstimator.AiOps` untouched in the diff; no migration added; no StepCard
    files touched. PASS.
  - C3: tests use a hand-written `FakeTransport`/`FailingTransport` behind the real
    `ClaudeClient`/`ClaudeAiStepClient` — no network. Confirmed by reading
    `AnalyzeWithAiStepSpec.scala` and `PipelineRunServiceAiStepClientWiringSpec.scala`. PASS.
  - C4: see Phase 2 mutation re-run below — all 5 requested rows independently reproduced RED
    with the exact failure mode files-modified.md claims. PASS.
  - C5: extra-field rejection (`response-extra-field`) and the "no partial columns" invariant are
    both real and covered (mutation #2, and structurally the map is only built after all checks
    pass). PASS.
- No scope creep: the only non-`analyzewithai` change is the `convertformat` MCP doc gap in
  `write.ts`, explicitly called out in tasks.md 2.6 as an intentional one-word inclusion, not
  drive-by scope creep.
- No regressions: full `sbt test` (4492 tests) passes; `PipelineCreateTransactionalSpec`,
  `PipelineStepRequiredConfigSpec`, `PipelineAnalyzeServiceSpec`, `PipelineStepSpec`,
  `PipelineAnalyzeRoutesSpec` were all updated (not deleted) to reflect `analyzewithai` now being
  registered, per tasks.md 3.6.
- API contract: no schema/OpenAPI enumeration of op names/config shapes exists to update (task
  2.7's documented finding, and I independently ran `npm run check:schemas`, which passes).
- Planning artifacts (proposal/design/tasks/spec.md) match the shipped behavior on read-through
  (D1-D7 decisions all correspond to code I read).

### Phase 2: Code Review — PASS

Gates run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE`):
- `cd backend && sbt test` — **4492 tests, 0 failed** (independently run just now, not trusting
  the executor's report).
- `node scripts/check-scala-quality.mjs` — clean (170 pre-existing soft warnings, none in new
  files; all four new production files are 30-195 lines, well under budget).
- `npm run check:schemas` — passes (95 protocol surfaces, 49 files; consistent with task 2.7's
  finding that no schema enumerates op names).
- No `frontend/**` files changed — frontend gates correctly out of scope.

**Mutation re-run (C4), independently, per the evaluator brief's specific instruction to redo
rows 1, 8, 9, 10, 11** (each mutation applied to a fresh copy of `AnalyzeWithAiStep.scala`, run
with `sbt testOnly ... -z "<substring>"`, confirmed RED, then the file was restored byte-for-byte
and the full 31-test suite re-confirmed GREEN):

| Row | Mutation | Claimed failure | Observed failure | Match |
|---|---|---|---|---|
| 1 | `if (false && missing.nonEmpty) fail(...)` | NPE / wrong reason (`response-wrong-type`) | "response omits a declared key" → `NullPointerException`; "present but JSON null" → `response-wrong-type: 'score' must be a JSON number, got null` (not `response-missing-field`) | Exact match |
| 8 | malformed-JSON catch returns `null` | NPE | `NullPointerException` at the intercept call | Exact match |
| 9 | `if (false && !node.isObject) fail(...)` | `ClassCastException` | `ClassCastException` | Exact match |
| 10 | field-missing/field-not-string → placeholder strings | wrong reason (`response-missing-field`) | both tests failed: message was `response-missing-field: response is missing declared key(s): score, sentiment` instead of `field-missing`/`field-not-string` | Exact match |
| 11 | all four `Left(...)` cases → `acc` | no exception thrown (3 red together) | all 3 named tests ("ai-unavailable...", "ai-guardrail...", "transport reports an API error") failed with "no exception was thrown" | Exact match |

Each of these five mutated failure arms has its own **named assertion** in the test file
(`ex.getMessage should include("<reason-code>")`), not a bare "an exception was thrown" check —
confirmed by reading `AnalyzeWithAiStepSpec.scala` lines 85-195. This satisfies the brief's
concern that a lumped/crash-based red might be hiding an assertion that doesn't actually check
the reason code: it does check the reason code, in every one of the five rows re-run.

Other checks:
- Declared column order preserved end to end: `AnalyzeWithAiConfig` stores `outputSchema` as
  `Vector[AnalyzeWithAiOutputField]`, written as `JsArray` (never `JsObject`, avoiding
  spray-json's alphabetical key sort — `AnalyzeWithAiConfig.scala:46-52`); `enforce`'s final
  `cfg.outputSchema.map { field => ... }.toMap` iterates in declared order and the resulting
  `Map`'s iteration order is insertion order for the small immutable maps in play here; the
  "conforming response" test asserts `result.head.keys.toVector.takeRight(2) shouldBe
  Vector("sentiment", "score")` — order genuinely checked, not assumed.
- Trailing-content rejection: `enforce`'s parser calls `parser.nextToken() != null` after
  `readTree` and fails `response-malformed-json` if so (line 114); test "valid object followed by
  trailing content" exercises it and I confirmed row 7's mutation claim by inspection (not
  independently re-run, since it wasn't in the requested set, but the code path and dedicated
  test both exist).
- Tolerant decode with fields absent: `AnalyzeWithAiConfig.decode` defaults every field via
  `StepCodecUtil.str(obj, "...", "")` / `StepCodecUtil.typedArray`; `AnalyzeWithAiConfigSpec`'s
  "should default every field when the raw config is an empty object" test exercises this and is
  green.
- `ApiRoutes` wiring genuinely reaches the engine for both run and preview: `PipelineRunService`
  constructs exactly one `InProcessPipelineEngine` (`engine = new InProcessPipelineEngine(...,
  aiStepClient)`), and both `executeRun`/`submit` and `previewStep`/`previewAtNode` share that
  single engine instance — confirmed by reading `PipelineRunService.scala`. The new
  `PipelineRunServiceAiStepClientWiringSpec` additionally proves this end-to-end against a real
  Postgres-backed `PipelineRunService.submit()` call (not just that the constructor param
  compiles): the default-wired service fails `ai-unavailable`, the explicitly-wired service (real
  `ClaudeAiStepClient` over a fake failing transport) instead fails `ai-error` — a genuinely
  different code path was exercised. I read this test in full; it is well-constructed and not a
  tautology.
- HEL-1108 call-point comment: present both as a class-level scaladoc note and an inline comment
  immediately above the `client.send` call in `ClaudeAiStepClient.complete` — exceeds the bare
  minimum the ticket asked for.
- No network in tests: `AnalyzeWithAiStepSpec` and `PipelineRunServiceAiStepClientWiringSpec` both
  use hand-written fake `ClaudeTransport` implementations (`FakeTransport`, `FailingTransport`);
  no `HttpClaudeTransport` construction anywhere in the new test files.
- DRY/readable/modular: `AnalyzeWithAiConfig.validate` is shared verbatim between the write-path
  companion (`validateRawConfig`/`requiredConfigProblems`) and `PipelineAnalyzeService
  .inferAnalyzeWithAi`, matching design.md's explicit "cannot diverge" goal.
- Error handling: `decode`'s `Try`-wrapping in both `Companion` overrides is a genuine root-cause
  fix (documented in files-modified.md's probe notes, item 2) with its own test
  ("malformed config produces validationError and identity outputSchema").
- No dead code / no leftover TODO markers in the new files (grepped).

### Phase 3: UI Review — PASS (limited scope)

Trigger: `backend/src/main/scala/com/helio/api/ApiRoutes.scala` changed (AI client wiring), no
`frontend/**` changes (StepCard UI is explicitly out of scope per HEL-1109/C2). There is no new
user-facing surface to exercise for `analyzewithai` itself.

- Started servers via `scripts/concertino/start-servers.sh` (port 6538/9445) — `READY` for both;
  `assert-phase.sh servers` → `PASS servers`. Backend boots cleanly with no `ANTHROPIC_API_KEY`
  set (degrades to `AiStepClient.Unavailable` as designed, does not crash `ApiRoutes`
  construction).
- Loaded the app in Playwright, confirmed the existing dashboard/pipeline UI still renders and
  functions with zero console errors (0 errors, 0 warnings) — no regression from the `ApiRoutes`
  wiring change.
- No breakpoint/accessibility/empty-state review performed for `analyzewithai` specifically since
  no new frontend component exists yet to review (correctly deferred to HEL-1109).

### Overall: PASS

### Non-blocking Suggestions
- None beyond what's already tracked as follow-up tickets (HEL-1107 generatetext, HEL-1108 tier
  gating, HEL-1109 StepCard).
