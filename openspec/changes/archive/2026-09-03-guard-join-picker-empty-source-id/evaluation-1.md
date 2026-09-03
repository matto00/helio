# Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed against the CORRECTED ACs in ticket.md (join is picker-excluded; the ticket
title/original repro are wrong). Base 824aa914; commits bd440335 + 8b22f60d.

## Phase 1: Spec Review — FAIL

Verified PASS:

- **AC1** — `PipelineService.addStep` (L855+) and `updateStep` (L1062+) both rewritten onto
  `PipelineStepConfigCodec.secondaryDataSourceId`; join's previously unconditional
  `joinCheckF` is gone at both sites.
- **AC2** — `PatchSetApplyResolvers` (L189-204): the join arm (unconditional) and union arm
  (unconditional — the cell HEL-620 missed) are both replaced by the shared extractor.
- **AC3** — one shared helper (`PipelineStepConfigCodec.secondaryDataSourceId`), every call
  site rewritten onto it; no per-op copy remains anywhere.
- **AC4 / AC6a** — execution-progress.md §1.2-1.5 record four verbatim 404s against UNFIXED
  code (patch-set union empty, patch-set join empty, addStep join empty-default, updateStep
  join empty), §5.1 records the same four re-run green. The RED is real and recorded before
  the fix; the mandatory deterministic patch-set red (1.2/1.3) is present for both cells.
- **AC5 (mechanism)** — I confirmed against `git show 824aa914:<file>` that both ACL error
  strings are byte-identical (`s"Data source not found: $id"`, `s"edit $index: data source
  not found: $id"`) and that no non-empty-id path changed behavior: `Some(id) =>
  findByIdOwned(...)` is the same call with the same failure mapping.
- **Decision 4 literal check** — the guard is `.nonEmpty` on the raw string, NOT
  `.trim.nonEmpty`, at all three arms, and there is an explicit regression test asserting
  `secondaryDataSourceId(JoinConfig(" ", ...)) == Some(" ")`. Not looser than asked.
- **Fifth site** — `PipelineService.validateStepCrossOwnerRefs` (L200+) was genuinely
  unguarded on base (`case Success(jc: JoinConfig) => checkOwnedSource(jc.rightDataSourceId,
  user)`, no `.nonEmpty`); the rewrite is the same mechanism, correctly in scope, and
  disclosed in both execution-progress.md and files-modified.md.
- **Lesson 1/6 (changed fixtures)** — `git diff 824aa914..HEAD` on both modified test files
  shows ADDITIONS ONLY. No pre-existing assertion, fixture or expected value was altered
  anywhere in the diff. Nothing needed interrogating, which matches the design gate's finding.
- **Scope** — no frontend, schema, spec or unrelated files touched.

Issues:

1. **AC6b was not performed.** The AC is two-part and worded as a requirement: "b. UI
   regression guard ... Through the running UI: add a `union` step from the op picker (union
   IS in `OP_TYPES`) and choose its other source." execution-progress.md §5.3 and
   files-modified.md both state it was "not run interactively in this pass (backend-only
   verification budget)" and substitute the pre-existing `PipelineStepRoutesSpec` union test.
   That substitution is transparently labelled (good), but it is not what the AC asks for and
   the AC offers no such fallback. The union path through `PipelineService.addStep` was
   textually rewritten by this change, which is exactly why the AC asked for a live check at
   the one surface where a user actually drives it.

## Phase 2: Code Review — FAIL

Gates I ran myself in `WORKTREE_PATH` (fresh, not the executor's report):

- `cd backend && sbt test` → `Total number of tests run: 3622` / `Tests: succeeded 3622,
  failed 0, canceled 0` / `All tests passed` / exit 0. Matches the executor's claim exactly.
- Diff is backend-only (`git diff --name-only 824aa914..HEAD` → `backend/**` +
  `openspec/changes/**` only). The frontend gates would scan nothing relevant to this change
  and are therefore NOT cited as coverage here — the executor made the same call correctly.
- Because `git commit -n` skips the WHOLE husky hook (not only `check:helio-mcp-types`), I
  additionally ran the hook steps that do scan this diff: `check:scala-quality` (clean, 146
  pre-existing soft warnings, none in the touched files), `check:openspec` (clean),
  `check:repo-integrity` (clean), `check:spec-structure` (337 canonical specs, 0 issues).
  All pass, so the bypass hid nothing real.

Mutation claims — VERIFIED FIRST-HAND, not trusted from the transcript:

- **Empty-id leg alone.** I removed only the `.nonEmpty` filter from the join arm and ran
  `testOnly ...PipelineStepRoutesSpec`: `Tests: succeeded 72, failed 2` — exactly the two new
  join empty-id tests went RED ("POST with join type and the picker's exact empty-default
  config succeeds", "PATCH join step config to an empty rightDataSourceId stays allowed"),
  while "POST with join type and cross-user right-source returns 404" and "PATCH join step
  config to cross-user right-source returns 404" STAYED GREEN. The two legs are independently
  guarded, not only in conjunction.
- **Structural guard, handling axis.** I deleted the `JoinConfig` arm from
  `secondaryDataSourceId` alone and ran `testOnly ...PipelineStepSecondSourceGuardSpec`:
  RED with `kind 'join', field 'rightDataSourceId', populated decode: None was not equal to
  Some("real-id")`. The guard is non-vacuous on the axis it claims.
- Both mutations were reverted; `git status --porcelain` and `git diff` are empty, so the
  worktree is byte-identical to 8b22f60d.
- **Positive baseline holds and cannot pass vacuously**: the guard asserts
  `PipelineStep.Registry.size shouldBe 23` and `foundSecondSourceFields shouldBe 3` AFTER the
  loop, plus a second test asserting the exact `(kind -> field)` map. A non-`Product` decode
  `fail`s loudly rather than being skipped, per Decision 7. Both tests pass on the real tree.

Code quality: the extractor is small, well-placed (`PipelineStepConfigCodec`'s package — both
surfaces already import it, no new dependency edge), pure, well-commented with the reasoning
that justifies each choice. Imports were correctly pruned in `PatchSetApplyResolvers` and are
still all used in `PipelineService`. Net -111 lines of duplicated ACL blocks. No dead code, no
TODOs, no type-safety escape hatches beyond the `Any` the codec already forces (documented,
and covered by the Registry guard that exists precisely because of it).

Issues:

1. **The fifth site's behavior change is untested.** `validateStepCrossOwnerRefs` now accepts
   an empty join `rightDataSourceId` on the transactional `POST /api/pipelines` steps[] path
   — a real, user-visible behavior change introduced by this diff. `PipelineCreateTransactionalSpec`
   has cross-owner coverage (`:292` reject foreign, `:316` accept own) but NO empty-id test,
   and the executor's own mutation matrix (task 4.5) covers only the addStep/updateStep and
   patch-set surfaces. The change's own AC5 standard — each leg guarded independently — is
   therefore unmet at site 5. Concretely: had the executor written `case None =>
   Future.successful(Left(...))` at `PipelineService.scala:216`, the whole suite would still
   be green.

Non-blocking (see below): a documentation inaccuracy in files-modified.md and cosmetic
alignment in the new match block.

## Phase 3: UI Review — N/A

No trigger file changed: the diff touches `backend/src/**` and `openspec/changes/**` only —
no `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**` (the spec
deltas live under the change dir, not the canonical specs). Note this is the evaluator's own
Phase-3 trigger rule and does NOT discharge ticket AC6b, which is a delivery obligation
recorded under Phase 1 above.

## Overall: FAIL

The fix itself is correct, minimal, mechanism-constrained and genuinely well-evidenced — the
RED-first probes are real, the error strings are byte-identical, the guard is `.nonEmpty` not
`.trim.nonEmpty`, no fixture was massaged, and every mutation claim I spot-checked held up
under my own re-run. The two findings below are coverage/AC gaps, not defects in the fix.

## Change Requests

1. **Add an empty-id test for the fifth site** (`PipelineService.validateStepCrossOwnerRefs`),
   in `backend/src/test/scala/com/helio/services/pipelines/PipelineCreateTransactionalSpec.scala`,
   next to the existing pair at `:292`/`:316`: `service.create` with a `steps[]` entry of type
   `join` whose config is `{"rightDataSourceId":"","joinKey":"","joinType":"inner"}` must
   return `Right` with the pipeline persisted. Then run the single-leg mutation for it —
   restore the `.nonEmpty`-less form (or make the `None` branch return `Left`) at
   `PipelineService.scala:216`, confirm the new test alone goes RED while `:292`'s foreign-owner
   test stays GREEN, revert — and record that result in execution-progress.md's task-4.5
   matrix alongside the other four.

2. **Perform AC6b as written**, or escalate it rather than substituting for it. Start the dev
   servers (`scripts/concertino/start-servers.sh`), open a pipeline in the running UI, add a
   `union` step from the "+ Add transformation step" picker and choose its other source;
   record the observed result (and any console errors) in execution-progress.md §5.3, still
   labelled per the AC as a regression guard and NOT as evidence for the join fix. If you
   believe the AC should be waived, that must be an explicit stated decision with reasoning
   raised to the orchestrator — "backend-only verification budget" plus a unit-test substitute
   is exactly the "cite a gate that scans something else" pattern the ticket's own review
   lesson 4 warns against.

## Non-blocking Suggestions

- `files-modified.md` says four new tests were added to `PatchSetApplyServiceSpec`; the diff
  adds **three** (join-empty-accepted, union-foreign-rejected, union-empty-accepted) — the
  fourth it lists is the pre-existing, unmodified 7.9d join foreign-owned test. Fix the count
  so the PR body is accurate.
- `files-modified.md`'s bypass note says the commit bypassed "that one husky step". `git
  commit -n` skips the entire pre-commit hook (17 steps). Reword to say so, and note that the
  other diff-relevant steps were run separately — I re-ran `check:scala-quality`,
  `check:openspec`, `check:repo-integrity` and `check:spec-structure` and all pass, so nothing
  was actually missed; only the claim is narrower than the truth.
- `PipelineStepConfigCodec.scala:103-106`: the `=>` column is misaligned (the `LookupConfig`
  arm overruns) and there is a doubled blank line at `:108`. Cosmetic only — no scalafmt gate
  exists and `check:scala-quality` is clean.
