## Evaluation Report — Fold-in Cycle 1 (evaluation-3.md)

Reviewed HEAD: 6f9ae4b1618263276e98428879913dfa99a31b4f.

Diff base resolved live: ebfeb6af76fdb594e072e46458d660c423a1db63, the merge-base with origin/main. origin/main is now
at afc2a6872 and includes 626cf9852 (HEL-1799), 9c2b5ba8e (HEL-1800), b1c72f7ed (HEL-1805) and afc2a6872 (HEL-1812).

Scope reviewed:
- the fold-in commits a272e9e20 (reopen), 14dad24c8 (red) and 6f9ae4b16 (impl);
- the whole branch diff against the base.

### Phase 1: Spec Review — PASS

- **Fold-in AC (owner ruling FOLD-IN).** For inline dataset roots of a patch-set `pipeline` create, each of these
  refuses the whole undo with a 409 and nothing changes: appended rows, apply-era row edits and schema edits. The
  message gives counts only and names only the applier-owned inline source. A still-referenced inline source keeps
  HEL-1493 option B, for visible and hidden referencers alike. A clean undo still removes the pipeline, the source
  and its rows. Every scenario in `specs/patch-set-undo/spec.md` has a test.
- **Tasks 6.1-6.4 and 7.1-7.2** are marked done and match the code. `files-modified.md` lists the touched files.
- **The first requirement is merged** into `openspec/specs/patch-set-undo/spec.md`. The change delta holds only the
  new requirement. `check:openspec` is clean.
- **Scope.** Main source changes are limited to `services/patchsets/*` and `PatchSetApplicationRepository`. The
  existing `PatchSetUndoInlineSourceCleanupSpec` assertion changed only to tolerate the new optional
  `createdDataset` field, and it now also asserts that field. There are no edits to `DataSourceService`, the form
  submit path or helio-mcp.
- **Overlap with main.** The branch's 28 files and main's 72 changed files since the base do not intersect.
  `git merge-tree` of HEAD and origin/main is clean. I also merged origin/main into a throwaway copy and ran the
  related specs there (below).
- **No wire change.** The REST 409 body, MCP `undo_patch_set` wording and the web toast are unchanged.
- **CONSTRAINTS.** C1, C2, C3, C4, C5 and C14 were honored by this review. I started no servers.

### Phase 2: Code Review — PASS

**Red first, re-verified** in a throwaway detached worktree, since removed:
- 14dad24c8 is test-only: one new spec file.
- Against the pre-fold-in code, 5 tests pass and 7 fail. Each failure is the defect:
  - "expected a Conflict, got Right(...restored...)" for append, second root, row edit and schema edit;
  - the missing inline message for the own-reference case;
  - `restored` instead of `failed` for the Phase-2 re-check;
  - `removed` instead of `kept` for the Phase-2 reference case.

  This matches red-run-foldin.log.

**Mutations I re-ran myself** (throwaway worktree at 6f9ae4b16):
- **Kind filter dropped** (`case Some(live) if live.kind == DataSourceKind.Dataset` became `case Some(live)`): RED,
  13 passed and 1 failed. The failing test is "undo a non-dataset inline root whose updated_at moved".
- **Reference skip dropped in Phase 2 only.** I added a `skipRefs` flag and passed `false` only from
  `restorePipelineCreateUndo`, leaving Phase 1 intact. RED, 11 passed and 3 failed:
  - both option-B tests, with "no inline outcome", because the Phase-2 re-check now fails the edit;
  - "not fail the edit when the source gained another user before the re-check", with `failed` instead of
    `restored`.
- **Executor's other recorded mutations** (mutations-foldin.txt: drop the Phase-1 check, drop the hidden-count term,
  drop the Phase-2 re-check, flip the appended comparison, count the undone pipeline as a reference). These line up
  with the tests I read. I did not re-run them.

**No ids in messages:**
- The Phase-1 inline message is `edit N (pipeline create): its inline data source "<name>": <counts>`. The spec
  asserts it contains no source id, pipeline id or apply-era row id, on both the single-root and two-root cases.
- The Phase-2 phrase is count-only, `N inline data source(s) gained later work during the undo; nothing further was
  undone`. It is asserted at ERROR without the source id or name.
- The apply-time WARN in `withInlineStamps` logs only the exception class.

**PatchSetUndoService stays minimal.** The `pipeline` create arm passes `appliedAt`. `restorePipelineCreateUndo`
became a re-check that delegates to a renamed `deletePipelineAndInlineSources`, which has the original body: about
10 lines in total.

**The existing dataSource arm behaves exactly as before:**
- `blocking` now delegates to the extracted `blockingSource`, which is the same code, verbatim.
- The row and schema messages were extracted into `workMessages`, with identical strings.
- `PatchSetUndoDatasetLaterWorkSpec` (19 tests) passes unchanged.

**Journal.** `JournaledInlineSource.createdDataset` defaults to `None` and uses `jsonFormat3`, declared before use.
The read-back only stamps sources that have a `dataset_schema`, and a failure recovers to the unstamped source, so
it never fails the apply. Old journals fall back to `appliedAt`, which is tested.

**Gates I ran myself** in WORKTREE_PATH at 6f9ae4b16:
- `sbt testFull`, 7 shards (`-J-Xmx3g`, `nice -n 19`). Every shard exited 0 with
  `hel1468-guard failed=0 aborted=0`. The shards passed 727, 1643, 1525, 1360, 2067, 1387 and 1536 tests: 10,245
  succeeded, 0 failed, 5 canceled (pre-existing).
- `check:scala-quality`: clean, soft warnings only. `check:openspec` and `format:check`: clean.
- Web `frontend/src/features/patchSets` (jest, 3 workers): 80/80. MCP `helio-mcp/src/tools/refinement*`: 17/17.

On the merged tree (HEAD plus origin/main, throwaway, since removed), I ran
`testOnly com.helio.services.patchsets.* com.helio.services.sources.* com.helio.infrastructure.persistence.patchsets.* com.helio.infrastructure.persistence.sources.* com.helio.api.routes.patchsets.* com.helio.api.routes.panels.* com.helio.services.mcp.*`:
1297 succeeded, 0 failed.

### Phase 3: UI Review — N/A

This is a backend-only change, with no UI trigger paths. The web patchSets tests pass (above).

### Overall: PASS

### Non-blocking Suggestions

- PatchSetUndoConflictCheck.scala:64 gates the inline check on `edit.targetKind == "pipeline"` with no `op` test.
  This is harmless, because only a `create` journals `inlineSources`. Matching `("pipeline", "create")` would make
  the intent explicit.
- Two fold-in tests were added in the impl commit rather than the red one:
  - the old-journal fallback;
  - the per-source journal stamp.

  The second needs the new field. The fallback mutation family covers the first. This is the same C12 note as in
  cycle 1.
- The cycle-1 notes still stand: the 290-character arm at PatchSetUndoService.scala:126, and the
  `ConcurrentHashMap` side channel in the apply loop.
