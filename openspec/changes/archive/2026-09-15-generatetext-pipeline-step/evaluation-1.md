## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- AC1 (restated by owner ruling): `GenerateTextStep` emits `outputField` and `inferGenerateText`
  (PipelineAnalyzeService.scala:707-727) reports it as a `string-body` column via the same
  `convertformat` collision pattern, without calling the model. `PipelineAnalyzeGenerateTextSpec`
  (task 4.1) covers unknown-field / non-string-field / persisted-row-200 arms. Confirmed the
  markdown-Output render path is untouched (see C2 below) — correctly out of scope, not flagged as
  a gap.
- AC2: no token accounting reimplemented; `ClaudeClient`'s existing `maxTokens`/input-budget clamps
  are the only budget enforcement, surfacing as `ai-guardrail` (GenerateTextStep.scala fail case).
- AC3: openspec change validates (`openspec validate generatetext-pipeline-step --type change` →
  "Change 'generatetext-pipeline-step' is valid").
- All tasks.md items are checked and match the diff; `files-modified.md` accurately enumerates
  every touched file, including the three "verified unchanged" surfaces (D9's seventh surface,
  `PipelineCostEstimatorSpec`, `PipelineStepConfigCodecSpec`) — spot-checked, no edits present.
- No scope creep: `git diff --name-only` shows only backend step/registration/protocol files,
  their tests, `helio-mcp/src/tools/write.ts`, and the openspec change dir. No frontend files, no
  migration, no step-card/palette files touched.
- No regressions: full backend suite green (4521/4521, see Phase 2).
- Constraints (C1-C6, all binding, all honored):
  - C1: `AiStepRequest.ownerUserId` still defaults to `None` and `GenerateTextStep.apply` never
    populates it; `ctx.aiClient.complete` remains the sole call point (no HELIO_BETA_DAILY_MESSAGE_LIMIT
    reference anywhere in the diff).
  - C2: `git diff` on `*OutputBindingSpec*` and `*PanelContent*` is empty — no markdown slot change.
  - C3: `GenerateTextStep.apply` is a strict `foldLeft` over `Future`, one call per row, no toggle,
    no aggregate path.
  - C4: `git diff` on `*PipelineCostEstimator*` is empty; no new migration file in
    `backend/src/main/resources/db/migration/`; no step-card/op-palette files touched.
  - C5: verified below (mutation evidence).
  - C6: no re-implemented token math; relies on `ClaudeClient`'s clamps per D5.

### Phase 2: Code Review — PASS

Issues: none.

Gates re-run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE`):
- `cd backend && sbt test` → 4521/4521 succeeded, 0 failed, 301 suites completed (4m39s).
- Targeted re-run of the 8 directly-touched specs → 246/246 succeeded (confirms the specific
  claims below independent of the full-suite run).
- `npm run check:helio-mcp-types` (the gate `files-modified.md` cites for the TS change) → passes,
  no errors.
- `npm run check:schemas` → passes ("schemas in sync ... 95 checked").
- `npx openspec validate generatetext-pipeline-step --type change` → valid.
- No `frontend/**` files changed in this diff, so `npm run lint` / `format:check` / `test` /
  `frontend` build are not applicable gates here (correctly out of scope per task instructions);
  confirmed via `git diff --name-only ... | grep -c '^frontend/'` → 0.

Targeted review findings:

1. **Sequential fail-fast fold, write-after-check** (GenerateTextStep.scala:52-70): `rows.foldLeft`
   over `Future`, `accF.flatMap` chains each row's call after the prior row's future resolves —
   row N+1's `ctx.aiClient.complete` is never invoked before row N's future completes, and a
   `fail(...)` throw inside the `.map` short-circuits the chained `Future` (no further `flatMap`
   bodies execute). `outputField -> responseText` is appended to the row only in the `Right`
   branch after `responseText.trim.isEmpty` is checked — a blank/failed cell is unreachable by
   construction. Confirmed via `GenerateTextStepSpec` task 3.2 ("failure on row 2 of 3 issues no
   call for row 3") passing.
2. **Six reason codes**, all reachable via `fail(code, detail)` → `IllegalArgumentException(s"generatetext $code: $detail")`.
   Verified against `AnalyzeWithAiStep`'s established `StepExecutionException.from` allowlist
   pattern (message kept verbatim for `IllegalArgumentException`); the engine-level assertion in
   task 3.6 passing confirms the code surfaces unmodified.
3. **`inferGenerateText`** (PipelineAnalyzeService.scala:707-727): never touches `ctx.aiClient` or
   any model call — pure schema arithmetic (validate config, look up `inputField` in
   `inputSchema`, reject non-`string`/`string-body` types, append/replace `outputField` as
   `string-body`). Satisfies restated AC1.
4. **D8 probe re-pointing** (PipelineAnalyzeRoutesSpec.scala:654-682): drops
   `pipeline_steps_op_check` inside the suite's own `EmbeddedPostgres` (`db.run(sqlu"ALTER TABLE
   pipeline_steps DROP CONSTRAINT pipeline_steps_op_check")`) before inserting `'notarealop'`.
   Ran the suite fresh and captured the actual failure: the 500 comes from
   `PipelineStepRepository.rowToDomain` → `Unknown step op: 'notarealop'.` (visible in the test-run
   stack trace), i.e. genuinely the decode/registry path, not the CHECK constraint. Comment
   explaining the drop's necessity is present and accurate.
5. **Mutation evidence** (files-modified.md "Mutation evidence" table): re-derived from the code —
   each of the six literal reason-code strings in `GenerateTextStep.scala` is a distinct string
   constant passed to `fail(...)`, and the corresponding assertions in `GenerateTextStepSpec` use
   `should include("<code>")`. The reported `-X`-suffix false-negative (`field-missing-X` still
   matching `include("field-missing")`) is a real and correctly-diagnosed failure mode of substring
   assertions, and the final `"wrong-code"` replacement genuinely falsifies each `include(...)`
   check (a `"wrong-code"` string cannot match `include("field-missing")` etc.). Cross-checked this
   reasoning against a fresh read of the test file's assertions — no test uses a match that would
   pass vacuously (e.g. no bare `.nonEmpty` or untyped `Left(_)` check standing in for the code).
6. **Registry-enumerating tests**: `PipelineStepRequiredConfigSpec` (26→27, exact keySet, new
   exemption + new rejection test), `PipelineStepSpec` (`All` set, `allSubtypes` fixture, pattern
   match case), `PipelineCreateTransactionalSpec` (reject-loop replaced by a real accept-and-`Right`
   assertion) are genuine additions/updates — diffed line-by-line above, not deletions or weakened
   assertions.

Standards compliance: no fully-qualified names at use sites in the new/touched files (grepped for
`com.helio.` outside `package`/`import` lines — zero hits in `GenerateTextStep.scala` /
`GenerateTextConfig.scala`). Config decode is tolerant per HEL-814 contract; validation is shared
between write-path and analyze-path (`GenerateTextConfig.validate`), satisfying DRY. No dead code,
no TODO/FIXME introduced. No over-engineering — no schema enforcement was added for free text (D3),
consistent with scope.

### Phase 3: UI Review — N/A

No files under `frontend/**` changed; `ApiRoutes.scala` unchanged; no `schemas/**` changes; no
`openspec/specs/**` changes (only the change-scoped `openspec/changes/generatetext-pipeline-step/
specs/pipeline-generatetext-op/spec.md`, which is not a live spec directory). Triggers not met —
Phase 3 correctly not run.

### Overall: PASS

### Non-blocking Suggestions

- None beyond what's already noted in design.md's own Risks section (batching/N-to-1 deferred,
  cost visibility trade-off) — these are explicitly deferred by owner ruling, not defects.
