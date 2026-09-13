## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit reviewed: `6adc97c05ba4be340345d55a8322fc13742b42bd` (on top of cb7d1a8d), addressing
evaluation-1.md's CR1-CR4 plus 3.8a. Diff since cb7d1a8d: 7 files, 749 insertions / 31 deletions,
all backend test files + openspec docs — no `frontend/**` files changed this cycle.

### Phase 1: Spec Review — PASS

Each cycle-1 Change Request re-checked against the actual test code (not files-modified.md prose):

- **CR1** (API-level cycle rejection on updateStep/import/duplicate/proposal-apply): confirmed in
  `PipelineCycleDetectionServiceSpec.scala` — new real `PipelineService.updateStep` (direct +
  transitive self-cycle, lines 601-667), `PipelineService.duplicateStep` (direct + transitive,
  lines 669-719), and `PipelineProposalService.apply` (direct + transitive, lines 721+) blocks,
  all driven through the real service entry points, not the repository test-seam. All 8 new
  cases reject correctly (no defect found in the shared cycle-guard wiring). "Import" is
  correctly identified as inapplicable: verified by my own grep of `ApiRoutes.scala` and
  `api/routes/pipelines/`/`services/pipelines/` — no pipeline-level import feature exists in this
  codebase; dashboard import/export never touches `pipeline_steps` or the cycle guard. Treating
  this as a documentation gap in the inherited ticket text rather than a coverage defect is
  correct and adequately explained in files-modified.md. CR1 fully resolved.
- **CR2** (scheduler-fired and grantee-triggered runs under a real NOBYPASSRLS role): confirmed
  in the new `PipelineRunServiceUpsertSourceRlsSpec.scala` — built on the same
  `helio_app_test`/`helio_privileged` two-role harness as the existing RLS spec, but driving the
  FULL `PipelineRunService`/`PipelineSchedulerService` graph. Test 1 calls the real
  `PipelineSchedulerService.tick()` against a due schedule row (line 188) and confirms the write
  lands under `ctx.withUserContext(owner)`. Test 2 calls the real
  `PipelineRunService.submit(pid, isDry = false, AuthenticatedUser(grantee))` (line 208) — a
  genuinely different, unrelated user account — and confirms the write is visible under the
  OWNER's RLS context and NOT under the grantee's own context. This directly closes the gap
  evaluation-1.md flagged (a pure source-reading argument was insufficient). CR2 fully resolved.
- **CR3** (genuinely concurrent race + mid-run edit): confirmed in
  `DataSourceRepositoryApplyWriteBacksSpec.scala`. The race test (lines 146-175) starts both
  `applyWriteBacks` futures before awaiting either (`val fut1 = ...; val fut2 = ...; await(fut1);
  await(fut2)`), which is a genuine overlap, not two sequential calls — confirmed by direct read.
  Assertions cover exactly one dataset created, both writes' rows landed, and the step rewritten
  exactly once. The mid-run-edit test (lines 177-198) updates the persisted step's config to a
  different new-source name mid-flight and confirms the run fails naming "configuration changed
  during the run," commits nothing, and the user's edit is kept. CR3 fully resolved.
- **CR4** (3.5 proven failable by mutation): files-modified.md records a live mutation
  (`if (isDry) onDryRunSuccess(...)` → `if (false) onDryRunSuccess(...)`) against
  `PipelineRunService.scala`, red (`Vector(...) had size 2 instead of expected size 1` — the dry
  run's write landed) then reverted to green. This is a real, reproducible, code-path-breaking
  mutation directly on the guard the AC cares about (dry runs must never write), not a
  documentation-only claim. CR4 fully resolved.
- **3.8a** (two upsert steps in one run, walk order): the new describe block in
  `PipelineRunServiceUpsertSourceSpec.scala` chains two trunk steps whose two possible orderings
  produce observably different row counts (1 vs 2) — a real, order-sensitive assertion, not a
  vacuous "both landed" check.

Standing Constraints re-verified:
- **C1** — still satisfied, now by two independent RLS-harness specs (existing +
  `PipelineRunServiceUpsertSourceRlsSpec`).
- **C2** — now 3.4 AND 3.5 are live-mutation-tested (red-then-green recorded for both); 3.3
  remains reasonably argued as MVCC-dependent rather than mutation-breakable, consistent with
  cycle 1's accepted rationale.
- **C3** — unchanged, still satisfied.

Tasks.md's remaining marked-partial items (3.9's "import" line, and a later-failing-sibling-step
/ step-level-preview sub-case of 3.5) are addressed adequately: 3.9's "import" is shown
inapplicable rather than skipped, and the sibling-step/preview sub-case of 3.5 is disclosed as an
accepted, reasoned inference (both paths structurally never reach the apply-writes branch),
consistent with how much of this ticket's scope tasks.md itself already scoped as sufficient once
the batch driver's explicit list (CR1-CR4) is satisfied. No unresolved required AC remains blocking.

### Phase 2: Code Review — PASS

Gates re-run fresh in `WORKTREE_PATH` this cycle (not trusted from files-modified.md), including
the FULL backend suite since shared code (`PipelineRunService.scala`, mutated then reverted) was
touched:

- `sbt test` (full suite) — **4342/4342 passed**, 288 suites, 0 failures. This is 12 more tests
  than cycle 1's full-suite count (4330), consistent with cycle 2's additions (RLS spec + race/
  mid-run-edit tests + 8 CR1 API-level tests + 3.8a), and confirms **no regression** to anything
  that passed in cycle 1.
- `npm run lint` (frontend) — clean, zero warnings (no frontend files changed this cycle; run
  anyway per instructions, still clean).
- `npm run format:check` (frontend) — clean.
- Frontend jest/build were not re-run this cycle since `git diff --name-only cb7d1a8d..HEAD --
  frontend/` is empty — no frontend source or test file changed; cycle 1's fresh jest/build
  results for the unchanged UI surface still stand.

No CONTRIBUTING.md-mechanical violations found in the new/changed test code on review; test
naming and structure are consistent with the surrounding suite's conventions. No scope creep —
all changes are new/extended tests plus openspec docs.

### Phase 3: UI Review — N/A

No `frontend/**`, `backend/.../ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**` files
changed this cycle. Cycle 1's Phase 3 findings stand unchanged.

### Overall: PASS

All four cycle-1 Change Requests are resolved with real, verified test code — not prose
reinterpretation of the escalation/CR text. The full backend suite (4342/4342) and frontend
static gates are green, with no regression versus cycle 1. Standing Constraints C1-C3 are
satisfied. Remaining minor scope notes (3.5's sibling-step/preview sub-case, 3.9's inapplicable
"import" line) are adequately reasoned and disclosed, not silently dropped, and do not block
acceptance criteria that are otherwise fully addressed.

### Non-blocking Suggestions

- Consider a dedicated (not merely reasoned-by-analogy) test for a later-failing sibling step and
  a step-level `previewStep` call, to fully close 3.5's remaining sub-case, in a follow-up ticket
  if not folded in here.
