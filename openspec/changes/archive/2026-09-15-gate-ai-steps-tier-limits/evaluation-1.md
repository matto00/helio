# Evaluation Report — Cycle 1 (evaluation-1.md)

Head reviewed: `7e4ac64099b51b77e57ccdd7e9279d802f757291`
Diff base (resolved LIVE via `resolve-review-base.sh`, exit checked): `0ce987459d101c726a0082ad330b2f5f624fa6d0`
Diff: 35 files, +2473 −66. No `frontend/` paths.

### Phase 1: Spec Review — PASS

- **AC1 (deny auto-run, failable probe): satisfied, and the executor's restraint was CORRECT.**
  Verified myself that the pre-existing probes key on the **`ai-step` reason code**, not on
  `autoRunnable` alone (C1): `PipelineCostEstimatorSpec:26` (`reasons.map(_.code) should contain
  "ai-step"`), `:27` (asserts the offending `stepId`), `:43` (`generatetext`), `:127`
  (multi-reason), plus `PipelineAnalyzeAnalyzeWithAiSpec:115-116` (explicit `fail(...)` when the
  reason is absent) and `PipelineAnalyzeGenerateTextSpec:110`. Flag-only assertions exist at
  `:25/:37/:49/:61/:174` but never *alone* for the AI arm, so C1 is honored. C9 honored — no
  manufactured production change.
- **Both corrected comments are accurate.** `PipelineCostEstimator.scala:20-23` now says both ops
  ARE registered; confirmed against `PipelineStep.Registry` (`analyzewithai`/`generatetext` both
  present). The dangling "tasks.md C3" reference is gone. Same for
  `PipelineCostEstimatorSpec:145-148`.
- **AC2 (clear error, never a silent no-op): satisfied** — see Phase 2 for the mechanism.
- All 39 tasks marked `[x]`; each maps to a real change in the diff. One task's *evidence* is
  weaker than its own wording claims (3b.4, Finding 1 below) though its shipped behavior is
  correct.
- No scope creep. C6 honored: no HEL-1109 / HEL-1136 / HEL-1135 scope absorbed.
- C5 honored: `backend/src/main/resources/db/migration/` has **zero** diff lines;
  `V107__add_writeback_ops.sql` remains the highest. No DDL.
- C7: nothing new crosses the wire — no `schemas/`, no protocol/JSON-format changes in the diff.
  `ai-quota-exceeded` travels as text inside the existing 422 / `error_log` / SSE `failed`
  surface, so there is no new `Option` field to normalize and no absent-field test owed.
- C8 honored (HEL-1100 D5 reused verbatim). Planning artifacts match the implementation.
- D9 verified rather than assumed: **no `frontend/` churn exists** in the file list.

### Phase 2: Code Review — PASS

**Gates re-run by me, not trusted from the handoff:**

| Gate | Result |
| --- | --- |
| `openspec validate gate-ai-steps-tier-limits --type change` | `is valid`, **exit 0** |
| `npm run check:scala-quality` | **clean** (172 soft size warnings only; zero hard violations — the 14 inline-FQN violations are genuinely fixed, CONTRIBUTING "Imports & Qualifiers" satisfied) |
| `cd backend && sbt test` | **exit 0 — Tests: succeeded 4541, failed 0; Suites: completed 303, aborted 0; "All tests passed."** Matches the executor's 4541/4541 claim exactly. |

**AC2 mechanism verified at the seam.** `ClaudeAiStepClient.complete` denies **before** any model
call: the gate is consulted first and `sendToModel` is only reachable on `Right(())`. A `None`
owner returns `Unavailable` **without consulting the gate** (asserted, and the gate's own
`checkInvocations` is asserted `0`). `quotaGate` is a **required, non-defaulted** constructor
parameter, so an ungated client is not constructible; `ApiRoutes` degrades to
`AiStepClient.Unavailable` when `Option(dbContext)` is `None`, and correctly avoids the
`chatAccessServiceOpt` val-init-order trap (design-gate N6).

**The no-compiler-guarantee risk (task 3.1a) is genuinely closed.** Both step files carry the
`QuotaExceeded` arm at line 72, mapping to `fail("ai-quota-exceeded", AiQuotaMessage(limit))`, and
`AiQuotaMessage` names the limit, the midnight-UTC reset, and the shared-with-chat budget. I
confirmed `StepExecutionException.from` allowlists only `IllegalArgumentException`, with `case
other` producing "step execution failed" — so the degradation risk is real and the arms are what
prevent it.

**C11 — owner threading: all FIVE sites verified by my own grep.** My first grep for
`backend.execute` matched only comments; the real invocations are `backend\n  .execute(`, at
**495 / 584 / 716 / 733 / 969**, and every one passes `ownerUserId = Some(pipeline.ownerId.value)`.
The per-execution path (`PipelineExecutionBackend.execute` → `InProcessExecutionBackend.execute` →
`executeTree` → `makeContext` at `:418`) is intact; `:218` (test-only flat path) is correctly left
defaulted `None`. `:716` having no mutation evidence is **correct per task 2.4a-i** (it runs
`Vector.empty` steps) and I did not treat it as missing evidence.

**Owner-charging (D5) and preview fix (D10/C10) verified.** The scheduled/grantee test asserts
both `shouldBe Some(<owner>)` and `should not be Some(editorId)`. The preview gate computes
`slicedSteps.exists(s => s.enabled && PipelineCostEstimator.AiOps.contains(s.kind))` **before**
`backend.execute`, permits owner or `findGrantRole == Some("editor")`, else `Forbidden`. The
`.enabled` conjunct is present, so a *disabled* AI step does not over-deny — matching the fact that
`closureOf` does not pre-filter disabled ancestors. Viewer denial asserts zero model calls via the
spy; owner/editor previews are charged to the owner; a viewer previewing an AI-free closure still
gets `Right`.

**Shared counter (D3/D7) verified.** `incrementIfUnderCap` is one atomic
`INSERT … ON CONFLICT … WHERE message_count < :limit RETURNING`, with `limit < 1` short-circuiting
**before** any DB access; the gate's `Live` treats `Owner` as uncounted and denies `free`/unresolved.

**Mutation spot-checks — I applied these myself and reverted (tree clean at `7e4ac640`):**

1. **Row 4** (`AnalyzeWithAiStep` `QuotaExceeded` arm deleted, line 72): **REPRODUCED.** 2 tests
   red — `Expected exception java.lang.IllegalArgumentException to be thrown, but scala.MatchError
   was thrown (AnalyzeWithAiStepSpec.scala:214)` and `"step execution failed" did not include
   substring "ai-quota-exceeded" (AnalyzeWithAiStepSpec.scala:249)`. Exactly the claimed shape, and
   it confirms the D6 degradation argument empirically.
2. **Row 2** (seam deny branch rewired to `sendToModel`): **REPRODUCED.** 2 tests red — the
   zero-transport-call assertion and `java.util.NoSuchElementException: None.get` on the
   distinguishability test. Exactly the claimed shape.

Both spot-checked rows are honest. Nothing I checked in the table was overstated.

Code quality: DRY (shared `AiQuotaMessage`; chat machinery reused, not reimplemented), type-safe
(no new escape hatches), fails closed at every boundary, no dead code, no over-engineering. The
cross-identity `withUserContext` carries its required inline comment (task 3.2a).

### Phase 3: UI Review — N/A

Confirmed from the diff rather than assumed: the changed-file list contains **no** `frontend/**`,
no `backend/src/main/scala/routes/ApiRoutes.scala`-equivalent contract change to a UI-consumed
shape, no `schemas/**`, and no `openspec/specs/**` (only `openspec/changes/**`). No UI-affecting
trigger matched, so no browser pass was run. D9's "no frontend change forced" is upheld by the
file list itself.

### Overall: PASS

All binding constraints C1–C11 are honored, both ACs are met, all three gates are green on my own
fresh runs, and the two mutation rows I re-derived by hand reproduce exactly as claimed.

### Change Requests

None blocking.

### Non-blocking Suggestions

1. **Task 3b.4's assertion is not failable as its own wording requires — the one real piece of
   evidence-shaped non-evidence I found.** The task demanded "a mutation that lets the denial write
   an empty row set makes the assertion go red." The shipped assertion
   (`PipelineRunServiceSpec:2489`) is `rows shouldBe empty` — but if a denial *did* write an empty
   row set through `overwriteRows`, `rows` would **still** be empty, so that assertion cannot
   discriminate "wrote nothing" from "wrote empty rows", and the stated mutation would **not** turn
   it red. Correspondingly, 3b.4 is the only task with no row in the 8-row mutation table.
   *The shipped behavior is nevertheless correct*, which I verified independently from source
   structure: `persistBackfilledRows` is reached only inside `evaluateNodeRowsForBackfill`'s success
   `.flatMap` (`:735-739`), never its `.recover` (`:741-743`), so a denial cannot write at all. The
   in-code comment also openly discloses the limitation and explains that the
   "leaves PRE-EXISTING rows untouched" sub-case is structurally unreachable via the only production
   caller (`backfillOutputNode` no-ops when `existing.nonEmpty`). Because the behavior is right and
   the gap is disclosed rather than concealed, this is not a blocker — but 3b.4 should not be read as
   carrying falsifiable evidence. A genuinely failable version would spy on
   `nodeSnapshotRepo.overwriteRows` and assert it is never invoked.
2. **The "satisfies V88 RLS without a bypass" claim is not verified by any test.**
   `AiPipelineQuotaGateSpec` runs Flyway and Slick as the `postgres` **superuser** (`:43`, `:46`) and
   constructs `new DbContext(db, db)` — the same superuser handle as both app and privileged pool. Per
   `MISTAKES.md`, superusers are `BYPASSRLS`, so V88's `user_id = current_setting(...)` policy never
   actually executes here. The tier semantics the spec targets (owner uncounted / beta increments /
   cap / limit-below-1) *are* properly verified; only the RLS assertion is not. This matches the
   repo's normal convention for non-RLS specs (there are dedicated non-superuser specs such as
   `V100ZeroRootGuardNonSuperuserSpec` and `RlsPolicyGuardSpec`), so it is a scoped evidence
   limitation, not a defect — stating it plainly rather than reporting it as green. A follow-up could
   cover the cross-identity write under a non-`BYPASSRLS` role.
3. **Preview-gate indentation (`PipelineRunService.scala:569-615`).** The new
   `authorizedForAi.flatMap { case true =>` arm leaves ~45 lines of pre-existing body at their old
   indentation, with a lone closing `}` at `:615`. It compiles and behaves correctly and the choice
   minimizes diff noise, but the block now reads as though it were outside the match arm. Re-indenting
   (or extracting the permitted path into a private method) would help the next reader.
