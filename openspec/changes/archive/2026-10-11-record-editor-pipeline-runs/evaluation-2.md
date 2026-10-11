## Evaluation Report — Cycle 2 (evaluation-2.md)

**Reviewed:** HEAD `67e6f5eaf57256bbaecd0f42e43ff1a7a9b1886e`, base `5a53d24b965a18e98729478b47949288cbb374d4` (resolved live).

**Spawn guard:** `READY ambient=/home/matt/Development/helio branch=bug/editor-pipeline-runs-unrecorded/HEL-1492`.

**Cycle-2 delta** (`git diff f478fa464 HEAD`):
- `docs/user-reference-inventory.md`
- `files-modified.md`
- `specs/pipeline-assert-evaluation/spec.md`
- `evaluation-1.md`

There is no change under `backend/` (`git diff --quiet f478fa464 HEAD -- backend` succeeds). The production code is therefore byte-identical to what cycle 1 gated with my own green `testFull`: `[hel1468-guard] failed=0`, 6985 succeeded. No fresh `testFull` was needed.

### Phase 1: Spec Review — PASS

**CR2 is resolved.** `specs/pipeline-assert-evaluation/spec.md` is now a REMOVED + ADDED pair.
- The REMOVED header exactly matches the live requirement at `openspec/specs/pipeline-assert-evaluation/spec.md:85`.
- The REMOVED block carries a Reason and a Migration.
- The ADDED requirement ("...never turns a missing run row into an unhandled failure") has scenario titles that match their bodies.
- It adds the "A run with no run row still resolves normally" scenario. That scenario corresponds to the revoked-editor dry-run test.
- `npx openspec validate record-editor-pipeline-runs --strict` returns `Change 'record-editor-pipeline-runs' is valid`.
- `check:openspec`, `check:spec-structure` and `format:check` are clean.

All cycle-1 Phase 1 findings stand otherwise:
- Every acceptance criterion is addressed.
- C1–C4 are honored.
- C5 is now fully evidenced (see Phase 2).

### Phase 2: Code Review — PASS

**CR1 is resolved.** Five new mutation proofs exist. Each `HEL-1492-mutation-<name>.txt` is a mutation-only `diff -u`, and each `-run.txt` recompiles and reports `[hel1468-guard] failed=1`. Each mutation fails exactly the intended test, for the intended reason:

1. **`revoked-dry-recheck-admits`**
   - Mutation: in `insertGranteeDryRun`, `submitterMayRunAction(...)` was replaced by `DBIO.successful(true)`.
   - Failing test: "write no dry_run row for a revoked editor's dry run...".
   - Failure: `Vector(RunRow("dry_run", Some(2), None)) was not empty`.
   - This proves the dry-run in-transaction recheck is load-bearing.
2. **`persistAssertions-no-recover`**
   - Mutation: `.recoverWith` was dropped from `persistAssertions`.
   - Failing test: the same revoked-dry test.
   - Failure: a `PSQLException` FK violation on `pipeline_run_assertions_run_id_fkey`.
   - This proves skeptic-design-3 note 2's guard is load-bearing.
3. **`unrunnable-attribution-none`**
   - Mutation: `recordUnrunnable` passes `triggeredByUserId = None`.
   - Failing test: "record the submitting user on a run recorded as unrunnable".
   - Failure: `Vector(None) was not equal to Vector(Some(...))`.
4. **`gone-grantee-capexceeded`**
   - Mutation: the grantee path's `case None` now returns `CapExceeded`.
   - Failing test: the pipeline-gone test, at line 430 (grantee assertion).
   - Failure: `CapExceeded was not equal to NotAuthorized`.
5. **`gone-owner-capexceeded`**
   - Mutation: the owner path's `if (!owned)` now returns `CapExceeded`.
   - Failing test: the same test, at line 431 (owner assertion).
   - Because this fails at 431 rather than 430, the grantee assertion passed, so each path is isolated.

With cycle 1's eleven proofs, every test added after the red run is now either mutation-proven or a positive path exercised by the other editor-run tests ("admit editor").

**Other checks:**
- The worktree is clean and HEAD has no backend diff, so the mutated files were restored.
- No sbt server was left running (`backend/project/target/active.json` is absent).
- The executor's `HEL-1492-v119-rerun.txt` shows `[hel1468-guard] failed=0`, 15 tests, after the inventory re-order.
- The inventory now lists the `pipeline_runs` row alphabetically (after `pipeline_run_rate_window`), and the legend defines `SET NULL`. Both cycle-1 non-blocking suggestions are done.
- The HEAD commit message has no claude.ai session link and no Claude-Session trailer.

### Phase 3: UI Review — N/A

The change is backend-only; there is no `frontend/**`, `schemas/**`, `ApiRoutes.scala` or live `openspec/specs/**` change. Same as cycle 1.

### Overall: PASS

### Non-blocking Suggestions

- `PipelineRunRepository.scala` is 628 lines. Per CONTRIBUTING line 24, the PR description should propose a split; the grantee admission/dry-run methods are a natural seam. This carries over from cycle 1.
