## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: `2c53d3b5536fbe65da922cf3c599d8bdf4a5cade`, the merge of `origin/main` into the branch.
History on top of the base:
- `12cd2ec0b`: the squashed implementation. It is byte-identical to the fix commit `46ea50b1d` (`git diff 46ea50b1d 12cd2ec0b` is empty).
- `492dcfa2d`: the archive commit.

Diff base: `2e02b79511fab222ac2bc73a142fc61e0979f192`, resolved live.

### Phase 1: Spec Review — PASS
Cycle-1 Phase 1 findings still hold; the code changed since cycle 1 only in comments, one import and one comparison.

Archive spec sync (diff `12cd2ec0b..492dcfa2d -- openspec/specs`):
- **`pipeline-run-guard`:** the requirement title now reads "Pipeline-run submission enforces the pipeline owner's concurrency cap". "per-user concurrency cap" appears 0 times. Duplicate `### Requirement:` headings: 0. The renamed block moved to the end of the file, which is how the archive tool applies a rename; the two requirements it moved past are unchanged.
- **`pipeline-run-execution`:** the Purpose is the written text, not "TBD". Both ADDED requirements were appended once.
- **`pipeline-schema-drift`:** the MODIFIED baseline requirement and the editor scenario are applied.
- **Placeholders:** there are 0 TBD or "TBD - created by archiving" lines in the three touched specs. Ten other, untouched specs still carry that placeholder; they predate this change and are out of scope.
- **Validation:** `openspec validate --specs --strict` passed 481 items with 0 failures, and `check:openspec` reports `openspec/ is clean`.
- **Archive directory:** the change now lives only under `openspec/changes/archive/2026-10-11-editor-run-baseline-status-codes/`. The live copy is gone. `files-modified.md` was removed before archiving, per the procedure.

### Phase 2: Code Review — PASS
Cycle-1 change requests (diff `56a46a0ac..12cd2ec0b`):
1. **Inline FQN, resolved.** `Hel1503EditorRunGapsSpec.scala` adds `import slick.jdbc.PostgresProfile.api.DBIO`, and `priv[T](a: DBIO[T])` uses it. A grep for `slick.dbio` finds nothing.
2. **`insertRunIfUnderConcurrencyCap` scaladoc, resolved.** Step 1 is now the `FOR KEY SHARE` row read (`PipelineGone`/`NotAuthorized`). Step 2 is the advisory lock, noted as taken after the row lock. There is no `pipelineOwnedAction` reference left. This matches the code.
3. **Grantee scaladoc, resolved.** Step (1) reads `FOR KEY SHARE` (absent row → `PipelineGone`), and step (3) yields `NotAuthorized` only for a revoked grant. The contradiction is gone and the text is re-wrapped.
4. **`PipelineRunExecutor` `NotAuthorized` arm comment, resolved.** It reads "grant revoked since `submit`'s check" only.
5. **HEL-505 dry-run comment, resolved.** It now says dry runs skip admission but are re-verified by `checkRunAuthorizationInternal` before executing.
6. **UUID compare, resolved.** The suggestion is applied: `rowOwner != UUID.fromString(user.id.value)`.

Merge with `origin/main` (`2c53d3b55`, parents `492dcfa2d` and `2e02b7951`):
- `git diff-tree --cc` shows no conflict-resolution hunks.
- `git diff 492dcfa2d 2c53d3b55` is byte-identical to the upstream delta `git diff 3c0ed6ce3 2e02b7951` (HEL-1490). The merge added nothing beyond upstream.
- The upstream delta touches 0 `backend/` files. HEL-1505 and HEL-1476 were already in this branch's base (`3c0ed6ce3`) before the merge.

Gates I ran myself at HEAD, in WORKTREE_PATH:
- **Targeted specs:** `nice -n 19 sbt -J-Xmx3g "testOnly Hel1503EditorRunGapsSpec PipelineRunEditorPersistenceSpec *PipelineRunRepositorySpec ExistenceNotLeakedRoutesSpec"` exited 0. Tests succeeded 134, failed 0, with `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`.
- **Full suite:** `nice -n 19 sbt -J-Xmx3g testFull` exited 0. Before starting I checked: MemAvailable was about 51 GB and no other sbt process was running. Suites completed 551, aborted 0. Tests succeeded 7340, failed 0, canceled 4. Output included `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`.
- **Scala quality:** `npm run check:scala-quality` is clean (soft warnings only).

Mutation evidence: cycle 1 re-ran M1, M5a, M5b and M6 and each failed exactly the named tests. Since then the only executable-code change is the owner-path UUID comparison. That comparison feeds the OWNER key-share test (e), and the targeted run above confirms it still passes.

### Phase 3: UI Review — N/A
No `frontend/**`, `schemas/**` or `ApiRoutes.scala` file differs between the base and HEAD; the HEL-1490 frontend changes are already in the base. The `openspec/specs/**` changes are spec text with no UI surface.

### Overall: PASS

### Non-blocking Suggestions
- `PipelineRunExecutor.scala:151-154`: the re-wrapped HEL-505 comment ends a line on "On `false`" and continues the sentence on the next line. Re-flow it when this file is next touched.
- `PipelineRunRepository.scala:589-591`: the `ConcurrencyCapResult` scaladoc's second line is still about 140 columns wide.
