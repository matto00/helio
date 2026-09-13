## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — FAIL

Verified against ticket.md's acceptance criteria (each is required, not optional) and tasks.md's
Standing Constraints, by reading the actual test code (not files-modified.md prose):

- AC "append preserves existing rows" — PASS (`PipelineRunServiceUpsertSourceSpec`, verified passing).
- AC "replace swaps atomically... proven by a real concurrent-read test" — PASS
  (`DataSourceRepositoryApplyWriteBacksSpec`, real separate-connection polling loop, verified running/green).
- AC "a failed write fails the run... proven by fault injection: zero rows committed" — PASS,
  and independently confirmed mutation-failable: the executor's C2 mutation record (remove the
  fail-fast escalation → red; restore → green) is a real, reproducible probe against 3.4.
- AC "validated with `DatasetRowValidator`... a mismatch fails the run" — PASS for the undeclared-
  column case tested directly; type/required/cap paths are exercised only indirectly via the
  validator's own pre-existing suite, which is an acceptable reuse of coverage, not a gap.
- AC "writes land under the pipeline owner's tenant... exercised under a non-superuser role" —
  PASS for the base owner/foreign-target case (`DataSourceRepositoryApplyWriteBacksRlsSpec`
  confirmed to build a real `helio_app_test` NOBYPASSRLS harness, not a superuser pool).
  **However** the batch driver explicitly required scheduler-fired and editor-grantee runs to
  also be exercised under a non-superuser role, not just the direct-owner case, and this was not
  done — `onRunSuccess`'s owner-identity construction is verified only by reading the source
  (confirmed at `PipelineRunService.scala:1124`, unconditional on `triggeringUser`), not by a
  dedicated RLS-role test that actually drives a run as a grantee or scheduler-tick and observes
  the GUC/RLS outcome. This is a real, not cosmetic, gap: reading the code proves what the code
  currently does, not that a future edit to this call site can't silently regress it under RLS —
  exactly the class of regression an RLS-role test exists to catch.
- AC "An API-level test proves HEL-1101's cycle guard rejects a direct and a transitive cycle on
  **every** create/update/import/duplicate/proposal-apply path it covers" — **FAIL as literally
  written.** Confirmed by reading `PipelineCycleDetectionServiceSpec`: only `create()` and
  `addStep()` gained real API-level (HTTP-shaped) tests in this delivery (lines 517-580).
  `updateStep`, import, duplicate, and proposal-apply are not covered at the API level — they
  reach the same repository call sites proven at the repository-seam by HEL-1101's pre-existing
  tests, but the ticket's AC text says "every ... path it covers," which the design.md D1 section
  itself lists as including `updateStep :2057` and `duplicate :2205`. The executor's own
  files-modified.md discloses this gap accurately, but disclosure does not satisfy a required,
  non-optional AC.
- AC "the pipeline editor does not crash... on a persisted `upsertsource` step" — PASS: verified
  `unsupportedOpType`/`isUnsupportedOpType` wiring in `stepNarrowing.ts`/`StepOpEditor.tsx`/
  `useStepCardState.ts`, and the associated Jest suites (75 tests, all green, confirmed by a
  fresh run) exercise the fallback, the read-only notice, and the no-PATCH-on-persist behavior.
- Op-wiring AC — PASS: registry/analyze parity confirmed; the other three ops remain rejected
  (`PipelineCreateTransactionalSpec`'s three pinned-rejection cases still pass, confirmed).

Standing Constraints (tasks.md):
- **C1** — PASS, confirmed via direct file read of the RLS harness.
- **C2** — PARTIAL as disclosed: only 3.4 was live mutation-tested; 3.3 and 3.5 were not, per the
  executor's own accounting. Tasks.md requires "3.3-3.5 ... proven failable by mutation" — this
  is not fully satisfied, though the executor's rationale for 3.3 (MVCC-dependent, not a
  single-mutation-breakable code path) is reasonable; 3.5's rationale ("structurally guaranteed")
  is weaker and was not actually probed.
- **C3** — PASS, confirmed.

Additional required-but-missing items called out explicitly by the batch driver (not merely
"nice to have," per the task instructions for this evaluation):
- Concurrent new-source race (two runs racing to create the same new-source dataset) — **not
  tested**, confirmed absent from `PipelineRunServiceUpsertSourceSpec` and
  `DataSourceRepositoryApplyWriteBacksSpec` (task 3.8, explicitly marked PARTIAL in tasks.md).
  This is exactly the case D7's step-row-lock serialization claim needs a real test to back up —
  currently it rests on design reasoning alone.
- Mid-run step edit (a user edits the target mid-run; run should fail, edit kept) — **not
  tested**, same 3.8 gap.
- Task 3.9 API-level coverage for update/import/duplicate/proposal-apply — **not tested**, per
  Phase 1 above.

Tasks.md marks 3.5, 3.7, 3.8, 3.8a, 3.9 as `[ ]` PARTIAL (not `[x]`) — the tasks file itself
already flags these as incomplete against its own literal wording, which the instructions for
this evaluation treat as required, not optional.

### Phase 2: Code Review — PASS

Gates re-run fresh in `WORKTREE_PATH` (not trusted from files-modified.md):
- `sbt testOnly` targeted at all upsertsource-related specs (`UpsertSourceStepSpec`,
  `PipelineCreateTransactionalSpec`, `PipelineCycleDetectionServiceSpec`,
  `PipelineRunServiceUpsertSourceSpec`, `DataSourceRepositoryApplyWriteBacksSpec`,
  `DataSourceRepositoryApplyWriteBacksRlsSpec`, `PipelineRunServiceSpec`) — 143/143 passed.
- `npm run lint` (frontend) — clean, zero warnings.
- `npm run format:check` (frontend) — clean.
- `npx jest stepNarrowing useStepCardState StepCard` — 75/75 passed.
- `npm --prefix frontend run build` — succeeded.

Code review of the diff (D1-D10 implementation) did not surface CONTRIBUTING.md/DESIGN.md
mechanical violations; the three self-reported root-cause fixes (registry-parity guards,
inline-FQN imports, Slick effect-type ascription) are legitimate and appropriately recorded.
No dead code, no scope creep beyond the ticket's op-wiring audit (D10), which was in scope.
This phase is not the reason for the FAIL verdict.

### Phase 3: UI Review — N/A

No `frontend/**` UI-surface change beyond the unsupported-step read-only notice/fallback, which
is exercised by the Jest suites above (StepOpEditor renders a notice, no config editor, no PATCH
on persist). Given the FAIL on required test coverage above and time constraints, dev-server
manual exercise of this fallback in the running app was not performed; the Jest coverage is
adequate evidence for this narrow, non-visual-design surface and Phase 3's own trigger scope
(`frontend/**`) is satisfied by static+unit verification here — this is not separately weighted
into the FAIL.

### Overall: FAIL

### Change Requests

1. Add API-level (real HTTP-shaped request, not repository-seam) cycle-rejection tests covering
   `updateStep`, pipeline import, duplicate, and proposal-apply with a registered `upsertsource`
   step, in `PipelineCycleDetectionServiceSpec`, to satisfy the ticket AC's literal "every ...
   path it covers" wording (tasks.md 3.9).
2. Add a dedicated non-superuser-role test exercising a scheduler-fired run and a grantee-
   triggered run writing under RLS as the pipeline owner (not just reading `onRunSuccess`'s
   source) — this was an explicit batch-driver requirement (tasks.md 3.7).
3. Add a concurrent-new-source-race test (two runs racing to create the same new-source dataset,
   proving the step-row lock serializes to exactly one dataset created) and a mid-run-edit test
   (edit lands, run fails with "step configuration changed during the run", nothing committed) —
   explicit batch-driver requirement (tasks.md 3.8).
4. Either add a mutation-proof for 3.5 (dry-run/preview never applies writes) or strengthen the
   documented rationale with a concrete probe (e.g., temporarily route a dry run through the
   real write path and show the existing dry-run assertions catch it) so C2's "3.3-3.5 proven
   failable by mutation" constraint is actually met rather than partially waived.

### Non-blocking Suggestions

- Consider a two-upsert-steps-in-one-run walk-order test (3.8a) in a follow-up if not folded
  into this cycle's fix.
